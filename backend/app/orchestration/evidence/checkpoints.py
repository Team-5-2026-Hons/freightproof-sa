"""Driver-logged in-transit checkpoints."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import IdempotencyKeyReusedError, ResourceNotFoundError
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import Trip
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint
from app.orchestration.evidence import action_location as action_location_service
from app.orchestration.evidence import location_assessment
from app.orchestration.evidence.corroboration import record_checkpoint_corroboration
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.orchestration.substitutions.access import WriteClaim, authorise_driver_write
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


async def _find_own_checkpoint(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: DriverCheckpointCreateBody,
) -> uuid.UUID | None:
    """This driver's own accepted checkpoint for the payload's client_report_id, if any.

    Needs both the key and the stamped actor: a report id alone could be someone else's.
    Checkpoints recorded before actors were stamped never match.
    """
    if payload.client_report_id is None:
        return None
    return (await db.execute(
        select(Checkpoint.id).where(
            Checkpoint.trip_id == trip_id, Checkpoint.client_report_id == payload.client_report_id,
            Checkpoint.performed_by_driver_id == driver_id,
        )
    )).scalar_one_or_none()


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


async def _corroborate_and_assess(
    db: AsyncSession,
    *,
    trip: Trip,
    checkpoint: Checkpoint,
    phase_event: PhaseEvent | None,
    payload: DriverCheckpointCreateBody,
) -> None:
    """Corroborate a freshly inserted checkpoint against the tracker and record what it shows.

    Runs only after the row is flushed (it needs checkpoint.id) and after a duplicate
    replay has already returned, so it executes exactly once per checkpoint.
    """
    horse_fix = await record_checkpoint_corroboration(
        db, trip=trip, checkpoint=checkpoint, driver_captured_at=payload.driver_captured_at,
    )

    evaluated_at = datetime.now(UTC)
    if phase_event is not None and payload.driver_captured_at is not None:
        assessment = await location_assessment.build_phase_assessment(
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
        assessment = location_assessment.build_checkpoint_assessment(
            checkpoint=checkpoint, horse_fix=horse_fix,
            driver_accuracy_metres=payload.driver_accuracy_metres, evaluated_at=evaluated_at,
        )
    checkpoint.action_location_assessment = assessment.model_dump(mode="json")
    await action_location_service.record_separation_finding(
        db, trip=trip, phase_event_id=None, checkpoint_id=checkpoint.id,
        assessment=assessment, driver_reason=None,
    )
    if phase_event is not None:
        await action_location_service.record_driver_location_finding(
            db, trip=trip, phase_event_id=phase_event.id, assessment=assessment,
            driver_reason=None,
        )


async def _load_checkpoint_phase(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID | None,
) -> PhaseEvent | None:
    phase_event: PhaseEvent | None = None
    if phase_event_id is not None:
        phase_result = await db.execute(
            select(PhaseEvent).where(
                PhaseEvent.id == phase_event_id,
                PhaseEvent.trip_id == trip_id,
            )
        )
        phase_event = phase_result.scalar_one_or_none()
        if phase_event is None:
            raise ResourceNotFoundError("PhaseEvent", str(phase_event_id))

    return phase_event


async def log_checkpoint(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: DriverCheckpointCreateBody,
) -> CheckpointRead:
    trip, custody = await authorise_driver_write(
        db, trip_id=trip_id, driver_id=driver_id,
        claim=WriteClaim(
            payload.custody_sequence,
            lambda: _find_own_checkpoint(db, trip_id=trip_id, driver_id=driver_id, payload=payload),
        ),
    )

    if payload.client_report_id is not None:
        existing = await _find_by_client_report_id(
            db, trip_id=trip_id, client_report_id=payload.client_report_id,
        )
        if existing is not None:
            if custody.sequence > 0 and existing.performed_by_driver_id != driver_id:
                raise IdempotencyKeyReusedError()
            return CheckpointRead.model_validate(existing)

    phase_event = await _load_checkpoint_phase(
        db, trip_id=trip_id, phase_event_id=payload.phase_event_id,
    )

    await _validate_trip_artifact(
        db, trip_id=trip_id, artifact_id=payload.selfie_artifact_id,
    )
    await _validate_trip_artifact(
        db, trip_id=trip_id, artifact_id=payload.cargo_photo_artifact_id,
    )

    checkpoint = Checkpoint(
        trip_id=trip_id,
        checkpoint_type=payload.checkpoint_type,
        driver_phone_lat=payload.driver_phone_lat,
        driver_phone_lng=payload.driver_phone_lng,
        driver_captured_at=payload.driver_captured_at,
        selfie_artifact_id=payload.selfie_artifact_id,
        cargo_photo_artifact_id=payload.cargo_photo_artifact_id,
        note=payload.note,
        is_deviation=payload.is_deviation,
        client_report_id=payload.client_report_id,
        phase_event_id=phase_event.id if phase_event is not None else None,
        performed_by_driver_id=driver_id,
        custody_sequence=custody.sequence,
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
    await _corroborate_and_assess(
        db, trip=trip, checkpoint=checkpoint, phase_event=phase_event, payload=payload,
    )

    await db.flush()
    await db.refresh(checkpoint)
    return CheckpointRead.model_validate(checkpoint)
