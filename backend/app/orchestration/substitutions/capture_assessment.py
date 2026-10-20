"""Each handover capture's phone-versus-tracker comparison (FP-83 C3 CP4).

A driver handover happens at a free-text exchange point, not a precinct, and it is not a phase,
so neither build_phase_assessment nor a fabricated stop applies. The capture is a bare phone fix,
which is exactly what build_capture_assessment already judges for checkpoints and driver reports:
the same accuracy, tracker-freshness and separation rules, with no precinct context.

Two rules shape this module:

- The tracker is read BEFORE the trip lock and never inside it, so a slow or failing Pulsit call
  cannot hold the trip, its crew and the request locked. The fix only informs a comparison; it
  authorises nothing, so reading it unlocked is safe.
- The comparison is fail-open, like phases.completion's: the driver has already made the capture,
  and a telemetry fault must never cost them it. A missing phone fix or tracker outage is not a
  fault: it is recorded explicitly as "unverified" with its reasons. Only a failure to build the
  comparison at all leaves the column NULL, and that is logged.
"""

import asyncio
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.driver_substitutions import DriverSubstitutionConfirmation
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus, get_pulsit_client
from app.orchestration.evidence import action_location

logger = logging.getLogger(__name__)

# Same budget as a driver exception report's tracker read: the capture must not wait on telemetry.
TRACKER_TIMEOUT_SECONDS = 2.0


def _unavailable(device_id: str | None) -> PulsitFix:
    source = PulsitFixSource.MOCK if settings.PULSE_USE_MOCK else PulsitFixSource.LIVE
    return PulsitFix(
        device_id=device_id or "unavailable", status=PulsitFixStatus.UNAVAILABLE,
        source=source, lat=None, lng=None, fixed_at=None,
    )


async def read_horse_fix(db: AsyncSession, *, trip_id: uuid.UUID) -> PulsitFix:
    """The trip horse's latest tracker fix, or an UNAVAILABLE fix. Never raises: an outage is a
    fact the assessment records, not an error. Call before taking the trip lock."""
    row = (await db.execute(
        select(Trip.operator_organization_id, Vehicle.pulsit_device_id)
        .join(Vehicle, Vehicle.id == Trip.horse_id).where(Trip.id == trip_id)
    )).one_or_none()
    if row is None or row.pulsit_device_id is None:
        return _unavailable(None if row is None else row.pulsit_device_id)
    try:
        return await asyncio.wait_for(
            get_pulsit_client(organization_id=row.operator_organization_id).get_position(row.pulsit_device_id),
            timeout=TRACKER_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("Handover tracker read unavailable for trip=%s: %s", trip_id, exc)
        return _unavailable(row.pulsit_device_id)


async def record_capture_assessment(
    db: AsyncSession, *, trip: Trip, confirmation: DriverSubstitutionConfirmation,
    horse_fix: PulsitFix, evaluated_at: datetime,
) -> None:
    """Store the capture's assessment and raise DRIVER_VEHICLE_SEPARATION when it measured one.

    `evaluated_at` is the server's moment of judgement, not the phone's claimed capture time; the
    skew between them is one of the reasons the assessment can report.
    """
    try:
        assessment = action_location.build_capture_assessment(
            driver_lat=None if confirmation.latitude is None else float(confirmation.latitude),
            driver_lng=None if confirmation.longitude is None else float(confirmation.longitude),
            driver_captured_at=confirmation.captured_at,
            driver_accuracy_metres=None if confirmation.accuracy_metres is None else float(confirmation.accuracy_metres),
            horse_fix=horse_fix, evaluated_at=evaluated_at,
        )
        confirmation.action_location_assessment = assessment.model_dump(mode="json")
        await db.flush()
        await action_location.record_separation_finding(
            db, trip=trip, phase_event_id=None, checkpoint_id=None, assessment=assessment,
            driver_reason=confirmation.discrepancy_note, substitution_confirmation_id=confirmation.id,
        )
    except Exception:
        logger.exception(
            "Handover location assessment failed for confirmation=%s: capture kept, recorded as not assessed",
            confirmation.id,
        )
