"""Compare the two drivers' seal captures at a handover and record what differs (FP-83 C3 CP4).

Each driver reads every applicable seal independently on their own phone, so the handover holds
two observations of the same seal taken minutes apart. Where they disagree the record says so
with the same finding types the phase ledger already uses, so a dispatcher triages a handover
discrepancy exactly as they would an arrival one:

- SEAL_COMPROMISED: either driver found the seal damaged or missing (an opening).
- SEAL_MISMATCH: the two readings differ, by number or by whether a seal exists at all (a swap).

Both can fire on one vehicle, as at arrival. A clean substitution is never itself an exception (a
problem transfer is flagged separately by transfer_review): only a
discrepancy writes a row here, and no trip status or hold is changed here (arrival's reasoning: a
finding is evidence, not a dead end). Findings are scoped to the confirmation that completed the
pair, so the partial unique index makes a replay or a race write each finding once.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
from app.db.models.transit import SUBSTITUTION_SEAL_FINDING_INDEX, TripException
from app.db.models.trips import Trip
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.exceptions.review_policy import initial_review_status
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.schemas.driver_substitutions import SealCheck, SubstitutionSealCondition

logger = logging.getLogger(__name__)

# CRITICAL like arrival's seal findings: a seal that changed between two drivers minutes apart
# is the theft indicator this product exists to record, not a warning-tier quality gate.
SEAL_FINDING_SEVERITY = ExceptionSeverity.CRITICAL
_BROKEN = frozenset({SubstitutionSealCondition.DAMAGED, SubstitutionSealCondition.MISSING})


@dataclass(frozen=True)
class SealDiscrepancy:
    vehicle_id: uuid.UUID
    exception_type: ExceptionType
    description: str


def _reading(check: SealCheck) -> str:
    if check.condition is SubstitutionSealCondition.NOT_APPLICABLE:
        return "not applicable"
    number = check.seal_number or "no number"
    return f"{check.condition.value} ({number})"


def compare_seal_captures(
    *, outgoing: Sequence[SealCheck], incoming: Sequence[SealCheck],
) -> list[SealDiscrepancy]:
    """Every discrepancy between the two captures, ordered by vehicle id then finding type.

    Pure. Both captures must cover the same vehicles (the service's capture validation enforces
    it); a gap is refused rather than skipped, because a skipped vehicle would read as agreement.
    """
    by_vehicle_out = {check.vehicle_id: check for check in outgoing}
    by_vehicle_in = {check.vehicle_id: check for check in incoming}
    if set(by_vehicle_out) != set(by_vehicle_in):
        raise ValueError("compare_seal_captures needs both captures to cover the same vehicles")

    findings: list[SealDiscrepancy] = []
    for vehicle_id in sorted(by_vehicle_out, key=str):
        out, inc = by_vehicle_out[vehicle_id], by_vehicle_in[vehicle_id]
        both = f"outgoing driver read {_reading(out)}, incoming driver read {_reading(inc)}"
        if out.condition in _BROKEN or inc.condition in _BROKEN:
            findings.append(SealDiscrepancy(
                vehicle_id, ExceptionType.SEAL_COMPROMISED, f"Seal found broken at the driver handover: {both}.",
            ))
        out_na = out.condition is SubstitutionSealCondition.NOT_APPLICABLE
        in_na = inc.condition is SubstitutionSealCondition.NOT_APPLICABLE
        numbers_differ = (
            out.seal_number is not None and inc.seal_number is not None and out.seal_number != inc.seal_number
        )
        if out_na != in_na or numbers_differ:
            findings.append(SealDiscrepancy(
                vehicle_id, ExceptionType.SEAL_MISMATCH, f"Seal readings differ at the driver handover: {both}.",
            ))
    return findings


async def record_seal_findings(
    db: AsyncSession, *, trip: Trip, confirmation_id: uuid.UUID,
    outgoing: Sequence[SealCheck], incoming: Sequence[SealCheck],
) -> list[uuid.UUID]:
    return await _record_discrepancies(db, trip=trip, confirmation_id=confirmation_id,
        discrepancies=compare_seal_captures(outgoing=outgoing, incoming=incoming))


async def record_incoming_seal_findings(
    db: AsyncSession, *, trip: Trip, confirmation_id: uuid.UUID, incoming: Sequence[SealCheck],
) -> list[uuid.UUID]:
    # No outgoing observation was requested: a real damaged/missing seal is evidence,
    # but a pairwise disagreement cannot be inferred from one driver's capture.
    findings = [SealDiscrepancy(check.vehicle_id, ExceptionType.SEAL_COMPROMISED,
        f"Incoming driver found seal {_reading(check)} at takeover.")
        for check in incoming if check.condition in _BROKEN]
    return await _record_discrepancies(db, trip=trip, confirmation_id=confirmation_id, discrepancies=findings)


async def _record_discrepancies(
    db: AsyncSession, *, trip: Trip, confirmation_id: uuid.UUID, discrepancies: Sequence[SealDiscrepancy],
) -> list[uuid.UUID]:
    written: list[uuid.UUID] = []
    for discrepancy in discrepancies:
        existing = (await db.execute(select(TripException.id).where(
            TripException.substitution_confirmation_id == confirmation_id,
            TripException.vehicle_id == discrepancy.vehicle_id,
            TripException.exception_type == discrepancy.exception_type,
        ))).scalar_one_or_none()
        if existing is not None:
            continue
        finding_id = uuid.uuid4()
        try:
            async with db.begin_nested():
                # register_exception, not a bare add: a CRITICAL finding owes its evidence anchor.
                await register_exception(db, TripException(
                    id=finding_id, trip_id=trip.id, substitution_confirmation_id=confirmation_id,
                    vehicle_id=discrepancy.vehicle_id, exception_type=discrepancy.exception_type,
                    source=ExceptionSource.SYSTEM, severity=SEAL_FINDING_SEVERITY,
                    review_status=initial_review_status(SEAL_FINDING_SEVERITY), description=discrepancy.description,
                ))
                await db.flush()
        except IntegrityError as exc:
            if not is_unique_violation(exc) or violated_constraint(exc) != SUBSTITUTION_SEAL_FINDING_INDEX:
                raise
            logger.info("Handover seal finding race for confirmation=%s: already recorded", confirmation_id)
            continue
        written.append(finding_id)
        enqueue_event(db, trip.operator_organization_id, TripEvent(
            id=trip.id, kind=RealtimeKind.EXCEPTION_RAISED, severity=event_severity(SEAL_FINDING_SEVERITY),
        ))
    return written
