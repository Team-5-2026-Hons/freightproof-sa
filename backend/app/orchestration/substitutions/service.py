"""The driver-handover lifecycle (FP-83 C3): arrange, cancel, replace, confirm, complete, correct.

Every function here runs in the caller's transaction and never commits: the request's `get_db()`
does, which is what makes "notice rows are written in the same transaction" true and a rollback
leave nothing behind. Endpoints are C6; there is deliberately no route to any of this yet.

Locking, in the feature-wide order (see access.lock_trip_statement for why FOR NO KEY UPDATE):
trip -> the two drivers and the trip's vehicles in sorted id order -> the request. Phase rows are
never locked here because a handover does not touch them; a driver's phase write takes the trip
lock first and so queues behind (or ahead of) a handover rather than interleaving with it.

A handover is only accepted on a live (ACTIVE or EXCEPTION_HOLD) trip. That check is made AFTER
the trip lock, so it also settles the activation race: activation sets ACTIVE under the same
lock, which means a handover can never be arranged against, or complete beside, an activation
that is still in flight.

Idempotency: each state-changing call carries a client_request_id. It is looked up, scoped to
the authenticated actor and the action, AFTER the actor's tenant has been checked and the trip
lock taken (so two identical calls cannot both pass the lookup) and BEFORE any state check, so
an exact retry gets the original answer even though the request has since moved on.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    IdempotencyKeyReusedError, IdentityAttestationForbiddenError, IdentityNotVerifiedError, IncomingDriverInactiveError,
    IncomingDriverUnavailableError, LicenceInvalidError, ResourceNotFoundError, SubstitutionError,
    SubstitutionInvalidError, SubstitutionNotPendingError, SubstitutionsDisabledError, SubstitutionVersionChangedError,
    TripStateError,
)
from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionCorrection,
    DriverSubstitutionOperation, DriverSubstitutionRequest, DriverSubstitutionUpload,
)
from app.db.models.enums import AnchorStatus, DispatcherRole, IdvsStatus, TripStatus, TripType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.people import Driver
from app.db.models.trips import DriverSubstitution, Trip
from app.blockchain.anchor_service import compute_payload_hash
from app.core.config import settings
from app.orchestration.substitutions import anchors, canonical, capture_assessment
from app.orchestration.substitutions.access import get_current_custody, lock_trip, lock_trip_statement
from app.orchestration.substitutions.eligibility import first_completion_blocker, require_arrangeable
from app.orchestration.substitutions.notices import notify_parties
from app.orchestration.substitutions.seal_comparison import record_seal_findings
from app.orchestration.substitutions.termination import cancel_request
from app.orchestration.substitutions.request_read import Viewer, build_request_read, trip_vehicle_ids
from app.orchestration.trips.availability import LIVE_STATUSES, lock_crew_set
from app.schemas.driver_substitutions import (
    ArrangeSubstitutionRequest, CancelSubstitutionRequest, CompleteSubstitutionRequest, ConfirmSubstitutionRequest,
    CorrectSubstitutionRequest, ReplaceSubstitutionRequest, SealCheck, SubstitutionCompletionBlocker,
    SubstitutionCompletionMode, SubstitutionNoticeKind, SubstitutionCorrectionRead, SubstitutionRequestRead, SubstitutionRole, SubstitutionState,
)
from app.schemas.people import DriverRead, UserRead

# Operation names; part of the idempotency key's scope, so they are stored verbatim.
ACTION_ARRANGE = "arrange"
ACTION_CANCEL = "cancel"
ACTION_REPLACE = "replace"
ACTION_CONFIRM = "confirm"
ACTION_COMPLETE = "complete"
ACTION_CORRECT = "correct"

# The contract's code for each way completion can be blocked, raised when a dispatcher's
# explicit /complete is refused (a driver's blocked confirmation is a 200 instead; see below).
_BLOCKER_ERRORS: dict[SubstitutionCompletionBlocker, type[SubstitutionError]] = {
    SubstitutionCompletionBlocker.INCOMING_DRIVER_INACTIVE: IncomingDriverInactiveError,
    SubstitutionCompletionBlocker.LICENCE_INVALID: LicenceInvalidError,
    SubstitutionCompletionBlocker.DRIVER_UNAVAILABLE: IncomingDriverUnavailableError,
    SubstitutionCompletionBlocker.IDENTITY_NOT_VERIFIED: IdentityNotVerifiedError,
}

ResultT = TypeVar("ResultT", bound=BaseModel)


def utcnow() -> datetime:
    """The server's clock. A module function (not an inline call) so tests can pin exact SAST instants."""
    return datetime.now(UTC)


# ── idempotency ──────────────────────────────────────────────────────────────


def body_digest(*scope: uuid.UUID, body: BaseModel) -> str:
    """SHA-256 of the canonical body plus the ids it was sent against, so the same key reused on
    another trip or request is a different body, not a replay."""
    canonical = json.dumps(
        {"scope": [str(item) for item in scope], "body": body.model_dump(mode="json")},
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True)
class OperationKey:
    """Who did what with which client key and body: the identity of one idempotent call."""

    action: str
    client_request_id: uuid.UUID
    digest: str
    actor_user_id: uuid.UUID | None = None
    actor_driver_id: uuid.UUID | None = None

    def _actor_matches(self) -> ColumnElement[bool]:
        if self.actor_user_id is not None:
            return DriverSubstitutionOperation.actor_user_id == self.actor_user_id
        return DriverSubstitutionOperation.actor_driver_id == self.actor_driver_id


async def find_replay(db: AsyncSession, key: OperationKey, *, result_type: type[ResultT]) -> ResultT | None:
    """The stored result of this actor's earlier identical call, or None if there was none.

    Raises IdempotencyKeyReusedError when the key was used for different content.
    """
    operation = (await db.execute(
        select(DriverSubstitutionOperation).where(
            key._actor_matches(), DriverSubstitutionOperation.action == key.action,
            DriverSubstitutionOperation.client_request_id == key.client_request_id,
        )
    )).scalar_one_or_none()
    if operation is None:
        return None
    if operation.body_digest != key.digest:
        raise IdempotencyKeyReusedError()
    return result_type.model_validate(operation.result_json)


def record_operation(
    db: AsyncSession, key: OperationKey, *, request_id: uuid.UUID | None, result: BaseModel,
    late_evidence_id: uuid.UUID | None = None,
) -> None:
    db.add(DriverSubstitutionOperation(
        actor_user_id=key.actor_user_id, actor_driver_id=key.actor_driver_id, action=key.action,
        client_request_id=key.client_request_id, body_digest=key.digest, request_id=request_id,
        late_evidence_id=late_evidence_id, result_json=result.model_dump(mode="json"),
    ))


# ── shared loading and checks ────────────────────────────────────────────────


async def lock_org_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    """Lock the trip, provided it belongs to the dispatcher's organisation (404 otherwise, so a
    foreign trip's existence is not disclosed)."""
    trip = (await db.execute(
        lock_trip_statement(select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id))
    )).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip


async def _load_request(db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID) -> DriverSubstitutionRequest:
    """The request row, locked, provided it belongs to this trip."""
    request = (await db.execute(
        select(DriverSubstitutionRequest)
        .where(DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip_id)
        .with_for_update(key_share=True)
    )).scalar_one_or_none()
    if request is None:
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    return request


def require_pending_at(request: DriverSubstitutionRequest, expected_version: int) -> None:
    if request.state != SubstitutionState.PENDING.value:
        raise SubstitutionNotPendingError(request_id=request.id, current_version=request.version)
    if request.version != expected_version:
        raise SubstitutionVersionChangedError(request_id=request.id, current_version=request.version)


def require_new_arrangements_enabled() -> None:
    """The DRIVER_SUBSTITUTIONS_ENABLED gate. Only new arrangements and replacements: called after
    the exact-replay check, so an already accepted arrangement still returns its result, and never
    on confirm/complete/cancel/correct, which must keep working while the flag is off."""
    if not settings.DRIVER_SUBSTITUTIONS_ENABLED:
        raise SubstitutionsDisabledError()


def require_live(trip: Trip, *, action: str) -> None:
    if TripStatus(trip.status) not in LIVE_STATUSES:
        raise TripStateError(current_status=TripStatus(trip.status).value, attempted_action=action)


async def _refuse_if_pending(db: AsyncSession, trip: Trip) -> None:
    """One live arrangement per trip. The client is pointed at the one that exists."""
    existing = (await db.execute(
        select(DriverSubstitutionRequest).where(
            DriverSubstitutionRequest.trip_id == trip.id, DriverSubstitutionRequest.state == SubstitutionState.PENDING.value,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise SubstitutionVersionChangedError(request_id=existing.id, current_version=existing.version)


def viewer_for(actor: UserRead) -> Viewer:
    return Viewer(is_dispatcher=True, is_admin=actor.role is DispatcherRole.ADMIN_DISPATCHER)


async def _checked_incoming(
    db: AsyncSession, *, trip: Trip, outgoing_driver_id: uuid.UUID,
    fields: ArrangeSubstitutionRequest | ReplaceSubstitutionRequest, now: datetime,
) -> Driver:
    """The incoming driver, after the tenant, difference, crew-lock and eligibility checks.

    The tenant lookup is unlocked (it only decides 404); eligibility is read AFTER the crew
    lock so two arrangements racing for one driver see each other's reservation.
    """
    incoming = (await db.execute(
        select(Driver).where(Driver.id == fields.incoming_driver_id, Driver.organization_id == trip.operator_organization_id)
    )).scalar_one_or_none()
    if incoming is None:
        raise ResourceNotFoundError("Driver", str(fields.incoming_driver_id))
    if incoming.id == outgoing_driver_id:
        raise SubstitutionInvalidError("The incoming driver is already driving this trip.")

    await lock_crew_set(db, driver_ids=[outgoing_driver_id, incoming.id], vehicle_ids=await trip_vehicle_ids(db, trip))
    await db.refresh(incoming)
    await require_arrangeable(db, trip=trip, incoming=incoming, expected_at=fields.expected_at, now=now)
    return incoming


def _new_request(
    *, trip: Trip, outgoing_driver_id: uuid.UUID, incoming: Driver, actor: UserRead,
    fields: ArrangeSubstitutionRequest | ReplaceSubstitutionRequest,
) -> DriverSubstitutionRequest:
    return DriverSubstitutionRequest(
        id=uuid.uuid4(), trip_id=trip.id, outgoing_driver_id=outgoing_driver_id, incoming_driver_id=incoming.id,
        exchange_label=fields.exchange.label, exchange_latitude=Decimal(str(fields.exchange.latitude)),
        exchange_longitude=Decimal(str(fields.exchange.longitude)), exchange_instructions=fields.exchange.instructions,
        expected_at=fields.expected_at, reason=fields.reason, is_planned=fields.is_planned,
        arranged_by_user_id=actor.id, version=1, state=SubstitutionState.PENDING.value,
    )


# ── arrange / cancel / replace ───────────────────────────────────────────────


async def arrange_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, actor: UserRead, payload: ArrangeSubstitutionRequest,
) -> SubstitutionRequestRead:
    """A dispatcher of the trip's organisation arranges for another driver to take it over.

    Saves a pending request and notifies both drivers. Nothing about the trip changes: only a
    completed handover moves custody. Identity is not required here (it is decided at
    completion), but the incoming driver must be active, licensed on the expected date and free.
    """
    trip = await lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    key = OperationKey(
        action=ACTION_ARRANGE, client_request_id=payload.client_request_id, actor_user_id=actor.id,
        digest=body_digest(trip_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=SubstitutionRequestRead)
    if replay is not None:
        return replay

    require_new_arrangements_enabled()
    require_live(trip, action="arrange a driver handover")
    outgoing_driver_id = (await get_current_custody(db, trip=trip)).driver_id
    await _refuse_if_pending(db, trip)
    now = utcnow()
    incoming = await _checked_incoming(db, trip=trip, outgoing_driver_id=outgoing_driver_id, fields=payload, now=now)

    request = _new_request(trip=trip, outgoing_driver_id=outgoing_driver_id, incoming=incoming, actor=actor, fields=payload)
    db.add(request)
    await db.flush()
    await notify_parties(db, request=request, kind=SubstitutionNoticeKind.ARRANGED)

    result = await build_request_read(db, request, viewer=viewer_for(actor), now=now)
    record_operation(db, key, request_id=request.id, result=result)
    await db.flush()
    return result


async def cancel_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, actor: UserRead, payload: CancelSubstitutionRequest,
) -> SubstitutionRequestRead:
    """Cancel a pending arrangement. The reservation ends with it (availability reads pending only)."""
    await lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    key = OperationKey(
        action=ACTION_CANCEL, client_request_id=payload.client_request_id, actor_user_id=actor.id,
        digest=body_digest(trip_id, request_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=SubstitutionRequestRead)
    if replay is not None:
        return replay

    request = await _load_request(db, trip_id=trip_id, request_id=request_id)
    require_pending_at(request, payload.expected_version)
    now = utcnow()
    cancel_request(request, reason=payload.reason, now=now)
    await db.flush()
    await notify_parties(db, request=request, kind=SubstitutionNoticeKind.CANCELLED)

    result = await build_request_read(db, request, viewer=viewer_for(actor), now=now)
    record_operation(db, key, request_id=request.id, result=result)
    await db.flush()
    return result


async def replace_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, actor: UserRead, payload: ReplaceSubstitutionRequest,
) -> SubstitutionRequestRead:
    """Cancel the pending request and create a fresh one in the same transaction.

    A material change is always a replacement, never an edit: the new request has a new id,
    version 1 and no confirmations, so nothing confirmed for the old arrangement carries over.
    The result is the cancelled old request, whose `replacement_request_id` names the new one.
    """
    trip = await lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    key = OperationKey(
        action=ACTION_REPLACE, client_request_id=payload.client_request_id, actor_user_id=actor.id,
        digest=body_digest(trip_id, request_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=SubstitutionRequestRead)
    if replay is not None:
        return replay

    require_new_arrangements_enabled()
    old = await _load_request(db, trip_id=trip_id, request_id=request_id)
    require_pending_at(old, payload.expected_version)
    require_live(trip, action="replace a driver handover")
    now = utcnow()
    # Checked before anything is changed, so an ineligible replacement leaves the old one pending.
    incoming = await _checked_incoming(db, trip=trip, outgoing_driver_id=old.outgoing_driver_id, fields=payload, now=now)

    cancel_request(old, reason=payload.replacement_reason, now=now)
    # The old row must stop being pending before the new one exists: one pending per trip.
    await db.flush()
    new = _new_request(trip=trip, outgoing_driver_id=old.outgoing_driver_id, incoming=incoming, actor=actor, fields=payload)
    db.add(new)
    await db.flush()
    old.replacement_request_id = new.id
    await db.flush()
    await notify_parties(db, request=old, kind=SubstitutionNoticeKind.CANCELLED)
    await notify_parties(db, request=new, kind=SubstitutionNoticeKind.ARRANGED)

    result = await build_request_read(db, old, viewer=viewer_for(actor), now=now)
    record_operation(db, key, request_id=old.id, result=result)
    await db.flush()
    return result


# ── confirm / complete ───────────────────────────────────────────────────────


async def lock_crew_and_request(db: AsyncSession, *, trip: Trip, request_id: uuid.UUID) -> DriverSubstitutionRequest:
    """Take the crew locks then the request lock, after the caller's trip lock.

    The driver ids are read without a lock first (they never change on a request), because the
    feature-wide order puts the crew before the request.
    """
    peek = (await db.execute(
        select(DriverSubstitutionRequest.outgoing_driver_id, DriverSubstitutionRequest.incoming_driver_id)
        .where(DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip.id)
    )).one_or_none()
    if peek is None:
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    await lock_crew_set(db, driver_ids=[peek.outgoing_driver_id, peek.incoming_driver_id], vehicle_ids=await trip_vehicle_ids(db, trip))
    return await _load_request(db, trip_id=trip.id, request_id=request_id)


async def _require_outgoing_still_holds(db: AsyncSession, *, trip: Trip, request: DriverSubstitutionRequest) -> int:
    """The custody sequence the handover will extend; the request is stale if the holder moved.

    A pending request normally cannot outlive a change of holder (completing one ends it), so
    this is a guard against corrupted state rather than a path anyone expects to take.
    """
    custody = await get_current_custody(db, trip=trip)
    if custody.driver_id != request.outgoing_driver_id:
        raise SubstitutionNotPendingError(request_id=request.id, current_version=request.version)
    return custody.sequence


async def _validate_capture(
    db: AsyncSession, *, trip: Trip, request: DriverSubstitutionRequest, role: SubstitutionRole,
    payload: ConfirmSubstitutionRequest,
) -> None:
    """Refuse a capture that does not describe this trip's vehicles, seals and the caller's photos.

    Contract rules: both drivers cover the complete assigned horse/trailer set; one seal check
    per applicable vehicle (each trailer, or the horse when there are none); "not applicable" is
    an empty-leg answer only; every cited photo is the confirming driver's own handover upload
    for this request and role (C4: substitutions.artifacts), and not already backing another
    capture. A phase photo, the other driver's upload or another request's upload never counts.
    """
    driver_id = request.outgoing_driver_id if role is SubstitutionRole.OUTGOING else request.incoming_driver_id
    assigned = await trip_vehicle_ids(db, trip)
    if set(payload.confirmed_vehicle_ids) != set(assigned):
        raise SubstitutionInvalidError("The capture must cover exactly the trip's horse and trailers.")
    trailers = assigned[1:]
    applicable = set(trailers) if trailers else {trip.horse_id}
    if {check.vehicle_id for check in payload.seal_checks} != applicable:
        raise SubstitutionInvalidError("Each trailer (or the horse, when there is no trailer) needs one seal check.")
    if trip.trip_type != TripType.EMPTY_LEG.value and any(
        check.condition.value == "not_applicable" for check in payload.seal_checks
    ):
        raise SubstitutionInvalidError("A loaded trip's seals must be read; 'not applicable' is for an empty leg.")

    photo_ids = [photo for check in payload.seal_checks for photo in check.photo_artifact_ids]
    if len(set(photo_ids)) != len(photo_ids):
        raise SubstitutionInvalidError("A photo can back only one seal check.")
    if photo_ids:
        owned = set((await db.execute(
            select(EvidenceArtifact.id)
            .join(DriverSubstitutionUpload, DriverSubstitutionUpload.artifact_id == EvidenceArtifact.id)
            .where(
                EvidenceArtifact.id.in_(photo_ids), EvidenceArtifact.trip_id == trip.id,
                EvidenceArtifact.captured_by_driver_id == driver_id,
                DriverSubstitutionUpload.request_id == request.id, DriverSubstitutionUpload.role == role.value,
                DriverSubstitutionUpload.driver_id == driver_id,
            )
        )).scalars())
        reused = (await db.execute(
            select(DriverSubstitutionConfirmationArtifact.artifact_id)
            .where(DriverSubstitutionConfirmationArtifact.artifact_id.in_(photo_ids)).limit(1)
        )).first()
        if owned != set(photo_ids) or reused is not None:
            raise SubstitutionInvalidError(
                "A cited photo is not your own upload for this handover, or backs another capture."
            )


@dataclass(frozen=True)
class CompletionFacts:
    """Everything that distinguishes one completion from another, gathered by the caller."""

    incoming: Driver
    now: datetime
    mode: SubstitutionCompletionMode
    completed_by_driver_id: uuid.UUID | None = None
    completed_by_user_id: uuid.UUID | None = None
    missing_confirmation_reason: str | None = None
    declared_exchange_at: datetime | None = None
    # Present only when an admin attested a PENDING identity; the attester is completed_by_user_id.
    identity_attestation_reason: str | None = None


async def _complete(
    db: AsyncSession, *, trip: Trip, request: DriverSubstitutionRequest, facts: CompletionFacts,
) -> DriverSubstitution:
    """Append the one completed amendment and end the request. Caller holds all the locks and
    has already decided the handover is allowed; this rechecks only who holds the trip.

    `substitution_at` is the server's moment, the only time custody is ever dated by; the
    declared exchange time is the claim, kept apart. The identity stored is the status as
    observed now, whatever it was when the driver confirmed, and an attestation never rewrites it.
    """
    sequence = await _require_outgoing_still_holds(db, trip=trip, request=request)
    previous_id = (await get_current_custody(db, trip=trip)).substitution_id
    attested = facts.identity_attestation_reason is not None
    incoming = facts.incoming
    row = DriverSubstitution(
        id=uuid.uuid4(), trip_id=trip.id, original_driver_id=request.outgoing_driver_id,
        substituting_driver_id=request.incoming_driver_id, exchange_location=request.exchange_label,
        approving_dispatcher_user_id=request.arranged_by_user_id, is_planned=request.is_planned,
        substitution_at=facts.now, exception_id=None, request_id=request.id, sequence_number=sequence + 1,
        previous_substitution_id=previous_id, completed_by_driver_id=facts.completed_by_driver_id,
        completed_by_user_id=facts.completed_by_user_id, completion_mode=facts.mode.value,
        declared_exchange_at=facts.declared_exchange_at, missing_confirmation_reason=facts.missing_confirmation_reason,
        incoming_identity_status=IdvsStatus(incoming.idvs_status).value,
        incoming_identity_last_verified_at=incoming.idvs_last_verified_at, incoming_identity_observed_at=facts.now,
        identity_attested_by_user_id=facts.completed_by_user_id if attested else None,
        identity_attestation_reason=facts.identity_attestation_reason, identity_attested_at=facts.now if attested else None,
        incoming_licence_expiry=incoming.license_expiry, eligibility_observed_at=facts.now,
    )
    db.add(row)
    request.state = SubstitutionState.COMPLETED.value
    request.terminal_at = facts.now
    await db.flush()
    # C5: the commitment is frozen with the completion, atomically; its anchor is queued for
    # after the outer commit. Anchoring never conditions the transfer itself.
    await anchors.freeze_substitution(db, row)
    await notify_parties(db, request=request, kind=SubstitutionNoticeKind.COMPLETED)
    return row


async def confirm_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, actor: DriverRead, payload: ConfirmSubstitutionRequest,
) -> SubstitutionRequestRead:
    """One of the two drivers records their capture; the last valid one completes the handover.

    The role comes from the authenticated driver, never the body, and a driver who is neither
    party gets the same 404 as a missing request. A saved capture is immutable and never lost: if
    completion is blocked (account, licence, availability, identity) the response is the PENDING
    request with `completion_blocked_by`, and ownership stays with the outgoing driver until a
    later eligible completion.

    Each capture also gets its own location assessment, and the second one compares both drivers'
    seal readings (CP4). Those findings are evidence only: they never block or alter completion.
    """
    named = (await db.execute(
        select(DriverSubstitutionRequest.outgoing_driver_id, DriverSubstitutionRequest.incoming_driver_id)
        .where(DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip_id)
    )).one_or_none()
    if named is None or actor.id not in (named.outgoing_driver_id, named.incoming_driver_id):
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))

    # Telemetry before any lock (capture_assessment's module docstring). An exact replay pays for
    # one wasted read rather than the lookup moving ahead of the lock that makes it safe.
    horse_fix = await capture_assessment.read_horse_fix(db, trip_id=trip_id)
    trip = await lock_trip(db, trip_id=trip_id)
    request = await lock_crew_and_request(db, trip=trip, request_id=request_id)
    key = OperationKey(
        action=ACTION_CONFIRM, client_request_id=payload.client_request_id, actor_driver_id=actor.id,
        digest=body_digest(trip_id, request_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=SubstitutionRequestRead)
    if replay is not None:
        return replay

    require_pending_at(request, payload.expected_version)
    require_live(trip, action="confirm a driver handover")
    await _require_outgoing_still_holds(db, trip=trip, request=request)
    role = SubstitutionRole.OUTGOING if actor.id == request.outgoing_driver_id else SubstitutionRole.INCOMING
    saved_roles = set((await db.execute(
        select(DriverSubstitutionConfirmation.role).where(DriverSubstitutionConfirmation.request_id == request.id)
    )).scalars())
    if role.value in saved_roles:
        # One immutable capture per role: the client's copy is behind, so it refetches.
        raise SubstitutionVersionChangedError(request_id=request.id, current_version=request.version)
    await _validate_capture(db, trip=trip, request=request, role=role, payload=payload)

    now = utcnow()
    confirmation = DriverSubstitutionConfirmation(
        id=uuid.uuid4(), request_id=request.id, role=role.value, driver_id=actor.id, captured_at=payload.captured_at,
        received_at=now, latitude=_decimal(payload.latitude), longitude=_decimal(payload.longitude),
        accuracy_metres=_decimal(payload.accuracy_metres),
        confirmed_vehicle_ids=[str(vehicle_id) for vehicle_id in payload.confirmed_vehicle_ids],
        seal_checks=[check.model_dump(mode="json") for check in payload.seal_checks],
        discrepancy_note=payload.discrepancy_note,
    )
    db.add(confirmation)
    await db.flush()
    position = 0
    for check in payload.seal_checks:
        for artifact_id in check.photo_artifact_ids:
            db.add(DriverSubstitutionConfirmationArtifact(
                confirmation_id=confirmation.id, artifact_id=artifact_id, vehicle_id=check.vehicle_id, position=position,
            ))
            position += 1
    request.version += 1
    await db.flush()
    await capture_assessment.record_capture_assessment(
        db, trip=trip, confirmation=confirmation, horse_fix=horse_fix, evaluated_at=now,
    )

    if len(saved_roles) + 1 == len(SubstitutionRole):
        await _compare_seals(db, trip=trip, request=request, second=confirmation)
        incoming = await _fresh_incoming(db, request)
        blocker = await first_completion_blocker(db, trip=trip, incoming=incoming, now=now, identity_attested=False)
        if blocker is None:
            await _complete(db, trip=trip, request=request, facts=CompletionFacts(
                incoming=incoming, now=now, mode=SubstitutionCompletionMode.NORMAL, completed_by_driver_id=actor.id,
            ))

    result = await build_request_read(db, request, viewer=Viewer(driver_role=role), now=now)
    record_operation(db, key, request_id=request.id, result=result)
    await db.flush()
    return result


async def _fresh_incoming(db: AsyncSession, request: DriverSubstitutionRequest) -> Driver:
    """The incoming driver as stored now (refreshed: eligibility is judged on current facts).
    The FK guarantees the row exists, so a miss is corruption and surfaces as not found."""
    incoming = await db.get(Driver, request.incoming_driver_id)
    if incoming is None:
        raise ResourceNotFoundError("Driver", str(request.incoming_driver_id))
    await db.refresh(incoming)
    return incoming


async def _compare_seals(
    db: AsyncSession, *, trip: Trip, request: DriverSubstitutionRequest, second: DriverSubstitutionConfirmation,
) -> None:
    """Record any seal discrepancy between the pair, scoped to the capture that completed it.

    Runs before the completion check, so a blocked completion still records its findings.
    """
    captures = {
        row.role: [SealCheck.model_validate(check) for check in row.seal_checks]
        for row in (await db.execute(
            select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id == request.id)
        )).scalars()
    }
    await record_seal_findings(
        db, trip=trip, confirmation_id=second.id,
        outgoing=captures[SubstitutionRole.OUTGOING.value], incoming=captures[SubstitutionRole.INCOMING.value],
    )


def _decimal(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


async def complete_attested_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, actor: UserRead, payload: CompleteSubstitutionRequest,
) -> SubstitutionRequestRead:
    """A dispatcher completes the handover, attesting only what is genuinely missing.

    It never creates or edits a driver's capture. With both captures saved it simply re-decides
    eligibility now (the way out of a blocked confirmation); with one or both absent it needs a
    reason. Unavailable identity (PENDING) needs an admin and a separate reason; FAILED is never
    overridden; an ordinary dispatcher's missing-capture reason bypasses nothing else.
    """
    trip = await lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    request = await lock_crew_and_request(db, trip=trip, request_id=request_id)
    key = OperationKey(
        action=ACTION_COMPLETE, client_request_id=payload.client_request_id, actor_user_id=actor.id,
        digest=body_digest(trip_id, request_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=SubstitutionRequestRead)
    if replay is not None:
        return replay

    require_pending_at(request, payload.expected_version)
    require_live(trip, action="complete a driver handover")
    await _require_outgoing_still_holds(db, trip=trip, request=request)
    incoming = await _fresh_incoming(db, request)

    saved_roles = set((await db.execute(
        select(DriverSubstitutionConfirmation.role).where(DriverSubstitutionConfirmation.request_id == request.id)
    )).scalars())
    missing = len(saved_roles) < len(SubstitutionRole)
    if missing and payload.missing_confirmation_reason is None:
        raise SubstitutionInvalidError("A reason is required to complete without both drivers' confirmations.")
    if not missing and payload.missing_confirmation_reason is not None:
        raise SubstitutionInvalidError("No confirmation is missing, so there is nothing to attest.")

    identity_reason = payload.identity_unavailable_reason
    if identity_reason is not None:
        if actor.role is not DispatcherRole.ADMIN_DISPATCHER:
            raise IdentityAttestationForbiddenError(request_id=request.id)
        if IdvsStatus(incoming.idvs_status) is IdvsStatus.VERIFIED:
            raise SubstitutionInvalidError("The driver's identity is verified, so there is nothing to attest.")
    # An attestation only ever helps a PENDING driver; for FAILED it is ignored by the check below.
    attested = identity_reason is not None and IdvsStatus(incoming.idvs_status) is IdvsStatus.PENDING

    now = utcnow()
    blocker = await first_completion_blocker(db, trip=trip, incoming=incoming, now=now, identity_attested=attested)
    if blocker is not None:
        raise _BLOCKER_ERRORS[blocker](request_id=request.id, current_version=request.version)

    mode = SubstitutionCompletionMode.DISPATCHER_ATTESTED if (missing or attested) else SubstitutionCompletionMode.NORMAL
    await _complete(db, trip=trip, request=request, facts=CompletionFacts(
        incoming=incoming, now=now, mode=mode, completed_by_user_id=actor.id,
        missing_confirmation_reason=payload.missing_confirmation_reason, declared_exchange_at=payload.declared_exchange_at,
        identity_attestation_reason=identity_reason if attested else None,
    ))
    request.version += 1
    await db.flush()

    result = await build_request_read(db, request, viewer=viewer_for(actor), now=now)
    record_operation(db, key, request_id=request.id, result=result)
    await db.flush()
    return result


# ── correction ───────────────────────────────────────────────────────────────

def _correction_commitment(
    *, correction_id: uuid.UUID, substitution: DriverSubstitution, actor_id: uuid.UUID, recorded_at: datetime,
    payload: CorrectSubstitutionRequest,
) -> tuple[dict[str, object], str]:
    """The frozen payload and its hash, built by the canonical module that verification rebuilds
    with (C5 adopted the C3 v1 commitment unchanged). Opaque ids and hashes only: the reason and
    note are free text that may name people, and personal data never reaches the commitment."""
    frozen = canonical.compute_correction_payload(record=canonical.CorrectionRecord(
        correction_id=correction_id, substitution_id=substitution.id, trip_id=substitution.trip_id,
        recorded_by_user_id=actor_id, recorded_at=recorded_at, reason=payload.reason,
        correction_note=payload.correction_note,
    ))
    return frozen, compute_payload_hash(frozen)


async def correct_completed_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, substitution_id: uuid.UUID, actor: UserRead, payload: CorrectSubstitutionRequest,
) -> SubstitutionCorrectionRead:
    """Append a clarification to a completed handover.

    It is a new immutable row with its own commitment and anchor state, in the history and the
    audit. It cannot change the drivers, the effective time or who holds the trip, because it
    touches none of those tables: a different custody outcome needs another handover.
    """
    await lock_org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    key = OperationKey(
        action=ACTION_CORRECT, client_request_id=payload.client_request_id, actor_user_id=actor.id,
        digest=body_digest(trip_id, substitution_id, body=payload),
    )
    replay = await find_replay(db, key, result_type=SubstitutionCorrectionRead)
    if replay is not None:
        return replay

    substitution = (await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.id == substitution_id, DriverSubstitution.trip_id == trip_id)
    )).scalar_one_or_none()
    if substitution is None:
        raise ResourceNotFoundError("DriverSubstitution", str(substitution_id))

    recorded_at = utcnow()
    correction_id = uuid.uuid4()
    frozen, event_hash = _correction_commitment(
        correction_id=correction_id, substitution=substitution, actor_id=actor.id, recorded_at=recorded_at, payload=payload,
    )
    db.add(DriverSubstitutionCorrection(
        id=correction_id, substitution_id=substitution.id, recorded_by_user_id=actor.id, reason=payload.reason,
        correction_note=payload.correction_note, payload_version=canonical.CORRECTION_PAYLOAD_VERSION, payload_json=frozen,
        event_hash=event_hash, anchor_status=AnchorStatus.PENDING.value, created_at=recorded_at,
    ))
    await db.flush()
    anchors.dispatch_custody_anchor(db, kind=anchors.CustodyAnchorKind.CORRECTION, record_id=correction_id)

    result = SubstitutionCorrectionRead(
        id=correction_id, substitution_id=substitution.id, recorded_by_user_id=actor.id, recorded_at=recorded_at,
        reason=payload.reason, correction_note=payload.correction_note, anchor_status=AnchorStatus.PENDING, receipt_id=None,
    )
    record_operation(db, key, request_id=substitution.request_id, result=result)
    await db.flush()
    return result
