"""Role-filtered reads for driver substitution (FP-83 C6).

Who may see what is decided here, once, for every route:

- A same-organisation dispatcher sees every request on the trip (newest first) and the late
  evidence retained on it, with signed artifact URLs so acknowledgement follows a real review.
- A driver sees only requests naming them. While a request is PENDING its context carries what
  the collection needs (remaining stops, the current phase, unreviewed findings, the photos of
  this handover). Once it is cancelled, replaced or completed, the same read is a frozen
  arrangement snapshot: no later live progress, positions or findings.
- A former (or current) participant's history is only their own: their custody periods, their
  own actions by opaque reference, their own photos and declarations. It never includes a later
  tracker trail, another driver's identity details, the cargo manifest or the exception stream.

Anyone else gets the same 404 as a missing record, so a trip's existence is not disclosed.
"""

import uuid
from collections.abc import Mapping
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionRequest,
    DriverSubstitutionUpload, LateDriverEvidence, LateDriverEvidenceArtifact, DriverSubstitutionCorrection, DriverSubstitutionNotice,
)
from app.db.models.enums import ExceptionReviewStatus, PhaseType, TripStatus, PhaseStatus
from app.db.models.people import Driver, User
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import DriverSubstitution, Trip, TripStop
from app.orchestration.evidence_anchors.reads import decorate_exception_reads
from app.orchestration.substitutions.anchors import LoadedChain, verify_custody_chain
from app.orchestration.substitutions.access import completed_links, custody_holders, participant_driver_ids
from app.orchestration.substitutions.late_evidence import build_late_evidence_read
from app.orchestration.substitutions.request_read import (
    Preloaded, Viewer, build_request_read, build_request_reads, required_confirmation_roles,
)
from app.orchestration.substitutions.guards import viewer_for
from app.schemas.driver_substitutions import (
    CustodyPeriodRead, DriverParticipationHistoryRead, DriverSubstitutionContextRead, LateEvidenceDetailRead,
    LateEvidenceKind, ParticipationActionRef, SealCheck, SubstitutionCompletionMode, SubstitutionConfirmationDetail,
    SubstitutionRequestRead, SubstitutionRole, SubstitutionState,
    CompletedSubstitutionSummary, CompletedSubstitutionDetail, SubstitutionCorrectionRead, SubstitutionPhaseContext,
    SubstitutionCompletionRead, SubstitutionCompletionTrigger, IdentityAttestationRead, SubstitutionNoticeRead,
)
from app.schemas.evidence import EvidenceArtifactWithUrl
from app.schemas.people import UserRead
from app.schemas.transit import TripExceptionRead
from app.orchestration.trips.detail import TripReadFacts
from app.schemas.trips import TripDetailResponse, TripStopRead
from app.storage.supabase_storage import create_signed_url


def _now() -> datetime:
    return datetime.now(UTC)


async def _signed(artifacts: list[EvidenceArtifact]) -> list[EvidenceArtifactWithUrl]:
    """Each artifact with a fresh signed URL (None when Storage declines; it is still evidence)."""
    out: list[EvidenceArtifactWithUrl] = []
    for artifact in artifacts:
        url = await create_signed_url(
            s3_bucket=artifact.s3_bucket, s3_key=artifact.s3_key, ttl_seconds=settings.EVIDENCE_SIGNED_URL_TTL_SECONDS,
        )
        out.append(EvidenceArtifactWithUrl.model_validate(artifact).model_copy(update={"signed_url": url}))
    return out


async def _org_trip(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> Trip:
    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id)
    )).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    return trip



async def _trip_request_rows(db: AsyncSession, *, trip_id: uuid.UUID) -> list[DriverSubstitutionRequest]:
    return list((await db.execute(
        select(DriverSubstitutionRequest).where(DriverSubstitutionRequest.trip_id == trip_id)
        .order_by(DriverSubstitutionRequest.created_at.desc(), DriverSubstitutionRequest.id)
    )).scalars().all())


async def list_trip_requests(db: AsyncSession, *, trip_id: uuid.UUID, actor: UserRead) -> list[SubstitutionRequestRead]:
    """Every arrangement on the trip, newest first."""
    await _org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    requests = await _trip_request_rows(db, trip_id=trip_id)
    return await build_request_reads(db, requests, viewer=viewer_for(actor), now=_now())


async def get_trip_request(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, actor: UserRead,
) -> SubstitutionRequestRead:
    await _org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    request = await _request_on_trip(db, trip_id=trip_id, request_id=request_id)
    return await build_request_read(db, request, viewer=viewer_for(actor), now=_now())


async def list_late_evidence(db: AsyncSession, *, trip_id: uuid.UUID, actor: UserRead) -> list[LateEvidenceDetailRead]:
    """Late evidence retained on the trip, oldest receipt first, with its typed payload and photos."""
    await _org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    rows = (await db.execute(
        select(LateDriverEvidence).where(LateDriverEvidence.trip_id == trip_id)
        .order_by(LateDriverEvidence.received_at, LateDriverEvidence.id)
    )).scalars().all()
    out: list[LateEvidenceDetailRead] = []
    for row in rows:
        receipt = await build_late_evidence_read(db, row)
        artifacts = (await db.execute(
            select(EvidenceArtifact)
            .join(LateDriverEvidenceArtifact, LateDriverEvidenceArtifact.artifact_id == EvidenceArtifact.id)
            .where(LateDriverEvidenceArtifact.late_evidence_id == row.id)
            .order_by(LateDriverEvidenceArtifact.position)
        )).scalars().all()
        out.append(LateEvidenceDetailRead.model_validate({
            **receipt.model_dump(), "evidence": row.evidence_json, "payload_sha256": row.payload_sha256,
            "artifacts": await _signed(list(artifacts)),
        }))
    return out



async def _request_on_trip(db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID) -> DriverSubstitutionRequest:
    request = (await db.execute(
        select(DriverSubstitutionRequest).where(
            DriverSubstitutionRequest.id == request_id, DriverSubstitutionRequest.trip_id == trip_id,
        )
    )).scalar_one_or_none()
    if request is None:
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    return request


def _role_of(request: DriverSubstitutionRequest, driver_id: uuid.UUID) -> SubstitutionRole | None:
    if driver_id == request.outgoing_driver_id:
        return SubstitutionRole.OUTGOING
    if driver_id == request.incoming_driver_id:
        return SubstitutionRole.INCOMING
    return None


async def get_driver_substitution_assignments(
    db: AsyncSession, *, driver_id: uuid.UUID,
) -> list[SubstitutionRequestRead]:
    """Pending handovers naming this driver on either side, independent of any active trip."""
    requests = (await db.execute(
        select(DriverSubstitutionRequest).where(
            DriverSubstitutionRequest.state == SubstitutionState.PENDING.value,
            or_(DriverSubstitutionRequest.outgoing_driver_id == driver_id,
                DriverSubstitutionRequest.incoming_driver_id == driver_id),
        ).order_by(DriverSubstitutionRequest.expected_at, DriverSubstitutionRequest.id)
    )).scalars().all()
    now = _now()
    return [
        await build_request_read(db, request, viewer=Viewer(driver_role=_role_of(request, driver_id)), now=now)
        for request in requests
    ]


async def _confirmation_details(
    db: AsyncSession, *, request_id: uuid.UUID, driver_id: uuid.UUID | None = None,
) -> list[SubstitutionConfirmationDetail]:
    query = select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id == request_id)
    if driver_id is not None:
        query = query.where(DriverSubstitutionConfirmation.driver_id == driver_id)
    rows = (await db.execute(query.order_by(DriverSubstitutionConfirmation.role.desc()))).scalars().all()
    completed = (await db.execute(select(DriverSubstitution).where(DriverSubstitution.request_id == request_id))).scalar_one_or_none()
    return [
        SubstitutionConfirmationDetail(
            id=row.id, role=SubstitutionRole(row.role), driver_id=row.driver_id, captured_at=row.captured_at,
            received_at=row.received_at, confirmed_vehicle_ids=[uuid.UUID(v) for v in row.confirmed_vehicle_ids],
            seal_checks=[SealCheck.model_validate(check) for check in row.seal_checks],
            discrepancy_note=row.discrepancy_note,
            latitude=None if row.latitude is None else float(row.latitude),
            longitude=None if row.longitude is None else float(row.longitude),
            accuracy_metres=None if row.accuracy_metres is None else float(row.accuracy_metres),
            location_observed_at=row.location_observed_at, location_unavailable_reason=row.location_unavailable_reason,
            action_location_assessment=row.action_location_assessment,
            location_observation_committed=completed is not None and completed.payload_version == 2,
        )
        for row in rows
    ]


async def _handover_photos(db: AsyncSession, *, request_id: uuid.UUID, driver_id: uuid.UUID) -> list[EvidenceArtifact]:
    """The caller's own uploads for this handover, plus photos cited by SUBMITTED captures (the
    counterpart's may be compared once they confirmed; an unconfirmed upload stays private)."""
    own = select(DriverSubstitutionUpload.artifact_id).where(
        DriverSubstitutionUpload.request_id == request_id, DriverSubstitutionUpload.driver_id == driver_id,
    )
    cited = (
        select(DriverSubstitutionConfirmationArtifact.artifact_id)
        .join(DriverSubstitutionConfirmation,
              DriverSubstitutionConfirmation.id == DriverSubstitutionConfirmationArtifact.confirmation_id)
        .where(DriverSubstitutionConfirmation.request_id == request_id)
    )
    return list((await db.execute(
        select(EvidenceArtifact).where(or_(EvidenceArtifact.id.in_(own), EvidenceArtifact.id.in_(cited)))
        .order_by(EvidenceArtifact.captured_at, EvidenceArtifact.id)
    )).scalars())


async def _remaining_stops(db: AsyncSession, trip: Trip) -> list[TripStopRead]:
    stops = (await db.execute(
        select(TripStop).where(TripStop.trip_id == trip.id).order_by(TripStop.sequence)
    )).scalars().all()
    current = trip.current_stop or 0
    return [TripStopRead.model_validate(stop) for stop in stops if stop.sequence >= current]


async def _open_findings(db: AsyncSession, trip_id: uuid.UUID) -> list[TripExceptionRead]:
    rows = list((await db.execute(
        select(TripException).where(
            TripException.trip_id == trip_id, TripException.review_status != ExceptionReviewStatus.REVIEWED,
        ).order_by(TripException.created_at)
    )).scalars())
    return await decorate_exception_reads(db, rows, [TripExceptionRead.model_validate(row) for row in rows])


async def get_driver_context(
    db: AsyncSession, *, trip_id: uuid.UUID, request_id: uuid.UUID, driver_id: uuid.UUID,
) -> DriverSubstitutionContextRead:
    """The driver-safe collection context. 404 unless the caller is named on the request."""
    request = await _request_on_trip(db, trip_id=trip_id, request_id=request_id)
    role = _role_of(request, driver_id)
    if role is None:
        raise ResourceNotFoundError("DriverSubstitutionRequest", str(request_id))
    trip = await db.get(Trip, trip_id)
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    base = await build_request_read(db, request, viewer=Viewer(driver_role=role), now=_now())
    live = SubstitutionState(request.state) is SubstitutionState.PENDING
    return DriverSubstitutionContextRead.model_validate({
        **base.model_dump(),
        "confirmations": await _confirmation_details(db, request_id=request.id),
        "remaining_stops": await _remaining_stops(db, trip) if live else [],
        "current_phase": PhaseType(trip.current_phase) if live and trip.current_phase else None,
        "findings": await _open_findings(db, trip.id) if live else [],
        "artifacts": await _signed(await _handover_photos(db, request_id=request.id, driver_id=driver_id)),
    })



async def _own_periods(db: AsyncSession, trip: Trip, driver_id: uuid.UUID) -> list[CustodyPeriodRead]:
    links = await completed_links(db, trip_id=trip.id)
    holders = await custody_holders(db, trip=trip)
    modes = {
        row.sequence_number: row.completion_mode for row in (await db.execute(
            select(DriverSubstitution).where(DriverSubstitution.trip_id == trip.id)
        )).scalars()
    }
    starts = {link.sequence_number: link.effective_at for link in links}
    periods: list[CustodyPeriodRead] = []
    for sequence in sorted(holders):
        if holders[sequence] != driver_id:
            continue
        mode = modes.get(sequence)
        periods.append(CustodyPeriodRead(
            custody_sequence=sequence, started_at=starts.get(sequence), ended_at=starts.get(sequence + 1),
            completion_mode=SubstitutionCompletionMode(mode) if mode else None,
        ))
    return periods


async def _own_actions(db: AsyncSession, trip_id: uuid.UUID, driver_id: uuid.UUID) -> list[ParticipationActionRef]:
    refs: list[ParticipationActionRef] = []
    for kind, model, at in (
        (LateEvidenceKind.PHASE, PhaseEvent, PhaseEvent.completed_at),
        (LateEvidenceKind.CHECKPOINT, Checkpoint, Checkpoint.created_at),
        (LateEvidenceKind.EXCEPTION, TripException, TripException.created_at),
    ):
        rows = await db.execute(
            select(model.id, model.custody_sequence, at).where(
                model.trip_id == trip_id, model.performed_by_driver_id == driver_id,
                model.custody_sequence.is_not(None), at.is_not(None),
            ).order_by(at)
        )
        refs.extend(
            ParticipationActionRef(kind=kind, id=row[0], custody_sequence=row[1], recorded_at=row[2]) for row in rows
        )
    return sorted(refs, key=lambda ref: (ref.recorded_at, str(ref.id)))


async def get_driver_participation_history(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
) -> DriverParticipationHistoryRead:
    """This driver's own part in the trip. 404 for a driver who never held it."""
    if driver_id not in await participant_driver_ids(db, trip_id=trip_id):
        raise ResourceNotFoundError("Trip", str(trip_id))
    trip = await db.get(Trip, trip_id)
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    own_artifacts = list((await db.execute(
        select(EvidenceArtifact).where(EvidenceArtifact.trip_id == trip_id, EvidenceArtifact.captured_by_driver_id == driver_id)
        .order_by(EvidenceArtifact.captured_at, EvidenceArtifact.id)
    )).scalars())
    request_ids = (await db.execute(
        select(DriverSubstitutionRequest.id).where(DriverSubstitutionRequest.trip_id == trip_id)
        .order_by(DriverSubstitutionRequest.created_at)
    )).scalars().all()
    declarations = [
        detail for request_id in request_ids
        for detail in await _confirmation_details(db, request_id=request_id, driver_id=driver_id)
    ]
    return DriverParticipationHistoryRead(
        trip_id=trip.id, trip_reference=trip.trip_reference, trip_status=TripStatus(trip.status),
        custody_periods=await _own_periods(db, trip, driver_id),
        action_references=await _own_actions(db, trip.id, driver_id),
        artifacts=await _signed(own_artifacts), declarations=declarations,
    )


async def with_dispatcher_custody(
    db: AsyncSession, detail: TripDetailResponse, *, actor: UserRead, facts: TripReadFacts,
) -> TripDetailResponse:
    """The dispatcher trip detail's FP-83 fields: every arrangement (newest first), the pending
    one, the custody-chain integrity read and whether new arrangements are enabled.

    `facts` is what get_trip_detail loaded for this trip. Its trip was read with the actor's
    organisation filter, so the three reads below that used to repeat that filter use it instead
    of querying again; the check is made here, against the actor, before anything is shared.
    """
    trip = facts.trip
    if trip is None or trip.id != detail.id or trip.operator_organization_id != actor.organization_id:
        raise ResourceNotFoundError("Trip", str(detail.id))

    requests = await _trip_request_rows(db, trip_id=trip.id)
    substitutions = list((await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == trip.id)
        .order_by(DriverSubstitution.sequence_number, DriverSubstitution.id)
    )).scalars())
    request_reads = await build_request_reads(
        db, requests, viewer=viewer_for(actor), now=_now(), preloaded=Preloaded(
            trip=trip, drivers=facts.drivers,
            completed_by_request={row.request_id: row for row in substitutions if row.request_id is not None},
        ),
    )
    completed = await _completed_summaries(
        db, substitutions, requests={request.id: request for request in requests},
        drivers=facts.drivers, phases=list(facts.phase_events),
    )
    integrity = await verify_custody_chain(
        db, trip_id=trip.id, organization_id=actor.organization_id,
        loaded=LoadedChain(trip=trip, rows=substitutions, requests=requests),
    )
    return detail.model_copy(update={
        "driver_substitutions": request_reads,
        "completed_driver_substitutions": completed,
        "pending_driver_substitution": next((r for r in request_reads if r.state is SubstitutionState.PENDING), None),
        "custody_integrity": integrity,
        "driver_substitutions_enabled": settings.DRIVER_SUBSTITUTIONS_ENABLED,
    })


def _recorded_phase_context(phases: list[PhaseEvent], effective_at: datetime) -> SubstitutionPhaseContext | None:
    resolved = {PhaseStatus.COMPLETED.value, PhaseStatus.EXCEPTION.value, PhaseStatus.OVERRIDDEN.value}
    boundaries = [(index, p.completed_at) for index, p in enumerate(phases) if p.status in resolved]
    if not boundaries or any(moment is None for _, moment in boundaries):
        return None
    if [index for index, _ in boundaries] != list(range(len(boundaries))):
        return None
    moments = [moment for _, moment in boundaries if moment is not None]
    if any(a > b for a, b in zip(moments, moments[1:])) or effective_at in moments:
        return None
    preceding = [index for index, moment in boundaries if moment is not None and moment < effective_at]
    if not preceding:
        return None
    index = preceding[-1] + 1
    if index >= len(phases):
        return None
    phase = phases[index]
    return SubstitutionPhaseContext(phase_event_id=phase.id, phase_type=PhaseType(phase.phase_type))


async def list_completed_substitutions(
    db: AsyncSession, *, trip_id: uuid.UUID, actor: UserRead,
) -> list[CompletedSubstitutionSummary]:
    await _org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    rows = list((await db.execute(select(DriverSubstitution).where(DriverSubstitution.trip_id == trip_id)
        .order_by(DriverSubstitution.sequence_number, DriverSubstitution.id))).scalars())
    phases = list((await db.execute(select(PhaseEvent).where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number))).scalars())
    return await _completed_summaries(db, rows, requests={}, drivers={}, phases=phases)


async def _completed_summaries(
    db: AsyncSession, rows: list[DriverSubstitution], *, requests: Mapping[uuid.UUID, DriverSubstitutionRequest],
    drivers: Mapping[uuid.UUID, Driver], phases: list[PhaseEvent],
) -> list[CompletedSubstitutionSummary]:
    """The summaries of `rows`. Requests, drivers and phases the caller already holds are used as
    given; any the rows name that it does not hold are read here, in one statement each."""
    driver_ids = {id_ for row in rows for id_ in (row.original_driver_id, row.substituting_driver_id)}
    missing_drivers = driver_ids - drivers.keys()
    drivers = {**drivers, **{d.id: d for d in (await db.execute(
        select(Driver).where(Driver.id.in_(missing_drivers)))).scalars()}} if missing_drivers else drivers
    wanted_requests = {row.request_id for row in rows if row.request_id} - requests.keys()
    requests = {**requests, **{r.id: r for r in (await db.execute(select(DriverSubstitutionRequest)
        .where(DriverSubstitutionRequest.id.in_(wanted_requests)))).scalars()}} if wanted_requests else requests
    result: list[CompletedSubstitutionSummary] = []
    for row in rows:
        request = requests.get(row.request_id) if row.request_id is not None else None
        outgoing, incoming = drivers[row.original_driver_id], drivers[row.substituting_driver_id]
        result.append(CompletedSubstitutionSummary.model_validate({
            'substitution_id': row.id, 'request_id': row.request_id, 'sequence_number': row.sequence_number,
            'outgoing': {'id': outgoing.id, 'full_name': outgoing.full_name, 'phone_number': outgoing.phone_number},
            'incoming': {'id': incoming.id, 'full_name': incoming.full_name, 'phone_number': incoming.phone_number},
            'effective_at': row.substitution_at, 'completion_mode': row.completion_mode,
            'anchor_status': row.anchor_status if row.payload_version is not None else None, 'receipt_id': row.blockchain_receipt_id,
            'phase_context': _recorded_phase_context(phases, row.substitution_at),
            'request_format': request.request_format if request else None,
            'required_confirmation_roles': list(required_confirmation_roles(request.request_format)) if request else None,
            'confirmation_policy': ('incoming_acceptance_v2' if request.request_format == 'immediate_v2' else 'two_driver_v1') if request else None,
        }))
    return result


async def _display_names(
    db: AsyncSession, *, organization_id: uuid.UUID, summary: CompletedSubstitutionSummary,
    driver_ids: set[uuid.UUID | None], user_ids: set[uuid.UUID | None],
) -> dict[uuid.UUID, str]:
    """Display labels for the ids a completed-transfer detail names, so the dispatcher reads people, not UUIDs.

    One query per kind, scoped to the dispatcher's organisation so a name never crosses tenants. The two
    drivers of the transfer are already on `summary` and cost nothing. An id that resolves to nothing is
    simply absent: the read never fails because a label is missing.
    """
    names: dict[uuid.UUID, str] = {summary.outgoing.id: summary.outgoing.full_name, summary.incoming.id: summary.incoming.full_name}
    wanted_drivers = {driver_id for driver_id in driver_ids if driver_id is not None and driver_id not in names}
    wanted_users = {user_id for user_id in user_ids if user_id is not None}
    if wanted_drivers:
        names.update((await db.execute(select(Driver.id, Driver.full_name).where(
            Driver.id.in_(wanted_drivers), Driver.organization_id == organization_id))).tuples().all())
    if wanted_users:
        names.update((await db.execute(select(User.id, User.full_name).where(
            User.id.in_(wanted_users), User.organization_id == organization_id))).tuples().all())
    return names


async def get_completed_substitution(
    db: AsyncSession, *, trip_id: uuid.UUID, substitution_id: uuid.UUID, actor: UserRead,
) -> CompletedSubstitutionDetail:
    await _org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    row = (await db.execute(select(DriverSubstitution).where(DriverSubstitution.id == substitution_id,
        DriverSubstitution.trip_id == trip_id))).scalar_one_or_none()
    if row is None:
        raise ResourceNotFoundError('DriverSubstitution', str(substitution_id))
    summary = next(s for s in await list_completed_substitutions(db, trip_id=trip_id, actor=actor) if s.substitution_id == row.id)
    request = await db.get(DriverSubstitutionRequest, row.request_id) if row.request_id else None
    confirmations = await _confirmation_details(db, request_id=request.id) if request else []
    photos = list((await db.execute(select(EvidenceArtifact)
        .join(DriverSubstitutionConfirmationArtifact, DriverSubstitutionConfirmationArtifact.artifact_id == EvidenceArtifact.id)
        .where(DriverSubstitutionConfirmationArtifact.confirmation_id.in_([c.id for c in confirmations]))
        .order_by(DriverSubstitutionConfirmationArtifact.position))).scalars())
    corrections = list((await db.execute(select(DriverSubstitutionCorrection)
        .where(DriverSubstitutionCorrection.substitution_id == row.id)
        .order_by(DriverSubstitutionCorrection.created_at, DriverSubstitutionCorrection.id))).scalars())
    names = await _display_names(
        db, organization_id=actor.organization_id, summary=summary, driver_ids={row.completed_by_driver_id},
        user_ids={request.arranged_by_user_id if request else None, row.completed_by_user_id, row.identity_attested_by_user_id,
                  *(c.recorded_by_user_id for c in corrections)},
    )
    completion = None if row.completed_by_driver_id is None and row.completed_by_user_id is None else SubstitutionCompletionRead(
        trigger=SubstitutionCompletionTrigger.DRIVER_CONFIRMATION if row.completed_by_driver_id else SubstitutionCompletionTrigger.DISPATCHER_ACTION,
        completed_by_driver_id=row.completed_by_driver_id, completed_by_user_id=row.completed_by_user_id,
        completed_by_name=names.get(completer_id) if (completer_id := row.completed_by_driver_id or row.completed_by_user_id) else None)
    identity = None if row.identity_attested_by_user_id is None else IdentityAttestationRead(
        attested_by_user_id=row.identity_attested_by_user_id, reason=row.identity_attestation_reason, attested_at=row.identity_attested_at,
        attested_by_name=names.get(row.identity_attested_by_user_id))
    notices = list((await db.execute(select(DriverSubstitutionNotice).join(DriverSubstitutionRequest,
        DriverSubstitutionRequest.id == DriverSubstitutionNotice.request_id).where(
        DriverSubstitutionNotice.request_id == request.id, DriverSubstitutionRequest.trip_id == trip_id,
        DriverSubstitutionNotice.recipient_driver_id == row.original_driver_id,
    ).order_by(DriverSubstitutionNotice.created_at, DriverSubstitutionNotice.id))).scalars()) if request else []
    return CompletedSubstitutionDetail.model_validate({
        **summary.model_dump(), 'reason': request.reason if request else None, 'confirmations': confirmations,
        'artifacts': await _signed(photos), 'corrections': [SubstitutionCorrectionRead(
            id=c.id, substitution_id=c.substitution_id, recorded_by_user_id=c.recorded_by_user_id,
            recorded_at=c.created_at, reason=c.reason, correction_note=c.correction_note, anchor_status=c.anchor_status,
            receipt_id=c.receipt_id, recorded_by_name=names.get(c.recorded_by_user_id)) for c in corrections],
        'arranged_by_user_id': request.arranged_by_user_id if request else None,
        'arranged_by_name': names.get(request.arranged_by_user_id) if request else None, 'completion': completion,
        'identity_attestation': identity, 'declared_exchange_at': row.declared_exchange_at,
        'missing_confirmation_reason': row.missing_confirmation_reason,
        'outgoing_notices': [SubstitutionNoticeRead(id=notice.id, request_id=notice.request_id, trip_id=trip_id,
            kind=notice.kind, created_at=notice.created_at, read_at=notice.read_at) for notice in notices],
        'custody_integrity': await verify_custody_chain(db, trip_id=trip_id, organization_id=actor.organization_id),
    })
