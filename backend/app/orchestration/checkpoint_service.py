"""Driver-logged in-transit checkpoints."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.trips import Trip
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint
from app.orchestration import action_location_service
from app.orchestration.corroboration_service import record_checkpoint_corroboration
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.schemas.action_location import DriverLocationCapture
from app.schemas.transit import CheckpointRead, DriverCheckpointCreateBody

_CLIENT_REPORT_ID_INDEX = "uq_checkpoints_trip_client_report_id"


async def _find_by_client_report_id(
    db: AsyncSession, *, trip_id: uuid.UUID, client_report_id: uuid.UUID,
) -> Checkpoint | None:
    result = await db.execute(
        select(Checkpoint).where(
            Checkpoint.trip_id == trip_id,
            Checkpoint.client_report_id == client_report_id,
        )
    )
    return result.scalar_one_or_none()


async def _validate_trip_artifact(
    db: AsyncSession, *, trip_id: uuid.UUID, artifact_id: uuid.UUID | None,
) -> None:
    if artifact_id is None:
        return
    result = await db.execute(
        select(EvidenceArtifact.id).where(
            EvidenceArtifact.id == artifact_id,
            EvidenceArtifact.trip_id == trip_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise ResourceNotFoundError("EvidenceArtifact", str(artifact_id))


async def log_checkpoint(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: DriverCheckpointCreateBody,
) -> CheckpointRead:
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    # A replay is the original evidence exactly as first recorded, including its phase
    # attribution. Do this before reading mutable trip state or tracker telemetry.
    if payload.client_report_id is not None:
        existing = await _find_by_client_report_id(
            db, trip_id=trip_id, client_report_id=payload.client_report_id,
        )
        if existing is not None:
            return CheckpointRead.model_validate(existing)

    phase_event: PhaseEvent | None = None
    if payload.phase_event_id is not None:
        phase_result = await db.execute(
            select(PhaseEvent).where(
                PhaseEvent.id == payload.phase_event_id,
                PhaseEvent.trip_id == trip_id,
            )
        )
        phase_event = phase_result.scalar_one_or_none()
        if phase_event is None:
            raise ResourceNotFoundError("PhaseEvent", str(payload.phase_event_id))

    await _validate_trip_artifact(
        db, trip_id=trip_id, artifact_id=payload.selfie_artifact_id,
    )
    await _validate_trip_artifact(
        db, trip_id=trip_id, artifact_id=payload.cargo_photo_artifact_id,
    )

    # horse_gps_lat/lng are deliberately NOT read from the payload any more.
    #
    # They used to be, and that made the column worthless as evidence: the driver's
    # phone reported its own position AND asserted where the truck was, so a single
    # source wore two hats and the "cross-reference" compared a claim against itself.
    # The tracker reading taken below supersedes anything the client sends, which is
    # the only thing that makes this an independent second source (FP-143).
    #
    # The fields stay on DriverCheckpointCreateBody rather than being deleted, for
    # the same reason LoadingCompleteRequest.driver_visual_count does: an entry
    # queued offline under the old schema replays from the driver app's localStorage
    # with them populated, and a removed field would 422 that entry forever — the
    # queue would never drain. They are accepted and ignored. Delete only once no
    # client can still be holding one.
    checkpoint = Checkpoint(
        trip_id=trip_id,
        checkpoint_type=payload.checkpoint_type,
        driver_phone_lat=payload.driver_phone_lat,
        driver_phone_lng=payload.driver_phone_lng,
        # Task 0A: the driver's own submit-instant, stored unconditionally — never
        # gated by whether the horse position below ends up timely enough to keep.
        driver_captured_at=payload.driver_captured_at,
        selfie_artifact_id=payload.selfie_artifact_id,
        cargo_photo_artifact_id=payload.cargo_photo_artifact_id,
        note=payload.note,
        is_deviation=payload.is_deviation,
        client_report_id=payload.client_report_id,
        phase_event_id=phase_event.id if phase_event is not None else None,
    )
    if payload.client_report_id is None:
        db.add(checkpoint)
        await db.flush()
    else:
        try:
            async with db.begin_nested():
                db.add(checkpoint)
                await db.flush()
        except IntegrityError as integrity_exc:
            if (
                not is_unique_violation(integrity_exc)
                or violated_constraint(integrity_exc) != _CLIENT_REPORT_ID_INDEX
            ):
                raise
            winner = await _find_by_client_report_id(
                db, trip_id=trip_id, client_report_id=payload.client_report_id,
            )
            if winner is None:
                raise
            return CheckpointRead.model_validate(winner)
    # Flushed before corroboration so the row has its id — the corroboration log
    # lines identify the checkpoint they belong to, and a null id there would make
    # a Pulsit outage untraceable to the checkpoint it affected.
    # Never raises: a driver logging a roadside checkpoint must not be blocked by an
    # unreachable tracker API. A failure leaves horse_gps null, which means "we could
    # not check" — see corroboration_service's null-semantics contract. Task 0A:
    # driver_captured_at travels through so a stale Pulsit fix cannot masquerade as a
    # live one — see _within_corroboration_skew.
    #
    # R12: the returned fix is the SAME one just used above — never a second Pulsit
    # round trip for this one checkpoint — fed straight into the assessment below.
    horse_fix = await record_checkpoint_corroboration(
        db, trip=trip, checkpoint=checkpoint, driver_captured_at=payload.driver_captured_at,
    )

    # Task 5: the versioned proximity snapshot for this checkpoint, plus (when it
    # measures a genuine separation) a distinct DRIVER_VEHICLE_SEPARATION finding —
    # independent of and alongside whatever corroboration_service already wrote.
    # See orchestration/action_location_service.py.
    evaluated_at = datetime.now(UTC)
    if phase_event is not None and payload.driver_captured_at is not None:
        # The report still owns the capture; phase context contributes only the leg's
        # frozen stop/precinct reference so a resulting checkpoint finding is scoped.
        assessment = await action_location_service.build_phase_assessment(
            db,
            trip=trip,
            event=phase_event,
            horse_fix=horse_fix,
            driver_accuracy_metres=payload.driver_accuracy_metres,
            evaluated_at=evaluated_at,
            capture=DriverLocationCapture(
                driver_phone_lat=payload.driver_phone_lat,
                driver_phone_lng=payload.driver_phone_lng,
                driver_captured_at=payload.driver_captured_at,
                driver_accuracy_metres=payload.driver_accuracy_metres,
            ),
        )
    else:
        assessment = action_location_service.build_checkpoint_assessment(
            checkpoint=checkpoint, horse_fix=horse_fix,
            driver_accuracy_metres=payload.driver_accuracy_metres, evaluated_at=evaluated_at,
        )
    checkpoint.action_location_assessment = assessment.model_dump(mode="json")
    await action_location_service.record_separation_finding(
        db, trip=trip, phase_event_id=None, checkpoint_id=checkpoint.id,
        assessment=assessment, driver_reason=None,
    )
    # DRIVER_LOCATION_MISMATCH is phase-scoped only (see its own docstring): a bare
    # checkpoint capture never sets driver_in_precinct, so this only ever fires when
    # the checkpoint carries a real phase_event_id — and even then only if that
    # phase happens to be stop-anchored and not IN_TRANSIT, which no current
    # checkpoint path produces. Called anyway for symmetry with the finding above
    # and so it starts working the day that changes, with no second wiring pass.
    # No location_warning_reason on DriverCheckpointCreateBody, so driver_reason
    # is always None here.
    if phase_event is not None:
        await action_location_service.record_driver_location_finding(
            db, trip=trip, phase_event_id=phase_event.id, assessment=assessment,
            driver_reason=None,
        )

    await db.flush()
    await db.refresh(checkpoint)
    return CheckpointRead.model_validate(checkpoint)
