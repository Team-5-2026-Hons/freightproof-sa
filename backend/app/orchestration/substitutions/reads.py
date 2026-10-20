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
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionRequest,
    DriverSubstitutionUpload, LateDriverEvidence, LateDriverEvidenceArtifact,
)
from app.db.models.enums import ExceptionReviewStatus, PhaseType, TripStatus
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import DriverSubstitution, Trip, TripStop
from app.orchestration.evidence_anchors.reads import decorate_exception_reads
from app.orchestration.substitutions.anchors import verify_custody_chain
from app.orchestration.substitutions.access import completed_links, custody_holders, participant_driver_ids
from app.orchestration.substitutions.late_evidence import build_late_evidence_read
from app.orchestration.substitutions.request_read import Viewer, build_request_read
from app.orchestration.substitutions.service import viewer_for
from app.schemas.driver_substitutions import (
    CustodyPeriodRead, DriverParticipationHistoryRead, DriverSubstitutionContextRead, LateEvidenceDetailRead,
    LateEvidenceKind, ParticipationActionRef, SealCheck, SubstitutionCompletionMode, SubstitutionConfirmationDetail,
    SubstitutionRequestRead, SubstitutionRole, SubstitutionState,
)
from app.schemas.evidence import EvidenceArtifactWithUrl
from app.schemas.people import UserRead
from app.schemas.transit import TripExceptionRead
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


# ── dispatcher ───────────────────────────────────────────────────────────────


async def list_trip_requests(db: AsyncSession, *, trip_id: uuid.UUID, actor: UserRead) -> list[SubstitutionRequestRead]:
    """Every arrangement on the trip, newest first."""
    await _org_trip(db, trip_id=trip_id, organization_id=actor.organization_id)
    requests = (await db.execute(
        select(DriverSubstitutionRequest).where(DriverSubstitutionRequest.trip_id == trip_id)
        .order_by(DriverSubstitutionRequest.created_at.desc(), DriverSubstitutionRequest.id)
    )).scalars().all()
    viewer, now = viewer_for(actor), _now()
    return [await build_request_read(db, request, viewer=viewer, now=now) for request in requests]


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


# ── driver ───────────────────────────────────────────────────────────────────


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
    return [
        SubstitutionConfirmationDetail(
            id=row.id, role=SubstitutionRole(row.role), driver_id=row.driver_id, captured_at=row.captured_at,
            received_at=row.received_at, confirmed_vehicle_ids=[uuid.UUID(v) for v in row.confirmed_vehicle_ids],
            seal_checks=[SealCheck.model_validate(check) for check in row.seal_checks],
            discrepancy_note=row.discrepancy_note,
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
        # A finished request is a snapshot of the arrangement, never later live trip context.
        "remaining_stops": await _remaining_stops(db, trip) if live else [],
        "current_phase": PhaseType(trip.current_phase) if live and trip.current_phase else None,
        "findings": await _open_findings(db, trip.id) if live else [],
        "artifacts": await _signed(await _handover_photos(db, request_id=request.id, driver_id=driver_id)),
    })


# ── participation history ────────────────────────────────────────────────────


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


async def with_dispatcher_custody(db: AsyncSession, detail: TripDetailResponse, *, actor: UserRead) -> TripDetailResponse:
    """The dispatcher trip detail's FP-83 fields: every arrangement (newest first), the pending
    one, the custody-chain integrity read and whether new arrangements are enabled."""
    requests = await list_trip_requests(db, trip_id=detail.id, actor=actor)
    return detail.model_copy(update={
        "driver_substitutions": requests,
        "pending_driver_substitution": next((r for r in requests if r.state is SubstitutionState.PENDING), None),
        "custody_integrity": await verify_custody_chain(db, trip_id=detail.id, organization_id=actor.organization_id),
        "driver_substitutions_enabled": settings.DRIVER_SUBSTITUTIONS_ENABLED,
    })
