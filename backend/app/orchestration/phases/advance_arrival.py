"""The arrival phase: the seal as found at the gate, checked against the departure seal."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionSeverity, ExceptionType, PhaseStatus, SealCondition
from app.orchestration import corroboration_service
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.findings import _record_seal_finding, _seal_unverified_severity
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_arrival_canonical_payload_v2
from app.orchestration.phases.seals import _find_departure_for_leg, _normalized_seal
from app.schemas.phases import ArrivalCompleteRequest
from app.schemas.trips import TripDetailResponse


async def advance_arrival(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: ArrivalCompleteRequest,
) -> TripDetailResponse:
    """The seal inspection at the destination gate, before anything is opened.

    Holds the seal comparison that used to sit in advance_unloading. Being its own
    phase, completed before unloading can start (_gate_and_load's sequence rule), is
    what makes "inspected before opened" enforced rather than hoped for.

    No _reject_if_not_due and no scan gate: ARRIVAL is absent from
    phase_gate.GATED_PHASES for the reason advance_in_transit gives. The warehouse
    scans after arrival, so gating on the scan here would deadlock the leg.
    """
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Seal inspection",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration_service.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # This LEG's departure (strictly before this row), not "the trip's" —
    # a multi-stop trip can have several DEPARTURE rows, and a plain
    # phase_type == DEPARTURE trip-wide lookup would raise MultipleResultsFound
    # on a real cross-dock trip.
    departure_event = await _find_departure_for_leg(
        db, trip_id=trip_id, before_sequence=event.sequence_number,
    )

    artifact_hashes = await _assert_artifacts_belong_to_trip(
        db, trip_id=trip_id, artifact_ids=(payload.seal_photo_artifact_id,),
    )

    # None only when the seal is MISSING (the schema requires a number otherwise).
    seal_at_arrival = (
        None if payload.seal_number_at_arrival is None
        else _normalized_seal(payload.seal_number_at_arrival)
    )
    event.seal_number = seal_at_arrival
    event.seal_condition = payload.seal_condition.value
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id
    event.status = PhaseStatus.COMPLETED

    # "" when the departure row carries no seal at all. Reachable in normal
    # operation, not just from bad data: override_phase resolves a departure
    # WITHOUT ever writing a seal (it anchors only the override record, never seal
    # evidence), and _is_resolved treats
    # OVERRIDDEN as resolved, so the trip runs on to arrival with a NULL seal.
    # Normalizing first collapses NULL, "" and whitespace to one "not recorded"
    # case rather than leaving " " to masquerade as a real seal.
    departure_seal = _normalized_seal(departure_event.seal_number or "")

    # Independent of the number comparison below, so a broken seal is recorded even
    # when there is no departure seal to compare against, and a broken seal that also
    # carries the wrong number records both findings. Always CRITICAL: a seal found
    # damaged or missing at the gate is the in-transit opening this phase exists to catch.
    if payload.seal_condition != SealCondition.INTACT:
        _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_COMPROMISED, severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal found {payload.seal_condition.value} at arrival "
                f"(seal number read: '{seal_at_arrival or 'none'}')."
            ),
        )

    if not departure_seal:
        # NOT a SEAL_MISMATCH. There is no second seal here to differ from, so
        # claiming a mismatch would put a false theft indicator into the anchored
        # record and fire the driver app's critical alert (it treats seal_mismatch
        # as one of three alarm types) for something the driver did not cause and
        # cannot fix. The honest fact is narrower: continuity for this leg cannot
        # be checked. Severity splits on whether that absence is EXPLAINED, because
        # severity is what the dispatcher actually triages on (its exception list
        # keys the row's border accent and chip off severity; nothing anywhere reads
        # this description text, so the distinction cannot live in wording alone):
        #
        #   OVERRIDDEN — a dispatcher resolved the departure without a seal being
        #     captured. Authorised, and already on the ledger as its own
        #     DISPATCHER_NOTE. WARNING: worth seeing, not an alarm.
        #   anything else — the departure ran the seal-capture path (advance_departure
        #     writes seal_number unconditionally from a required field) and STILL has
        #     no seal. Nothing legitimate produces that, so it is a data-integrity
        #     anomaly and must stay loud. CRITICAL.
        #
        # Neither is INFO: an unverifiable seal chain is exactly what a real seal swap
        # would hide behind. _record_seal_finding writes the row and derives the
        # realtime severity from the same value, so the two cannot drift apart.
        seal_unverified_severity = _seal_unverified_severity(departure_event)
        _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_UNVERIFIED, severity=seal_unverified_severity,
            description=(
                f"Seal continuity could not be verified for this leg: no seal was "
                f"recorded at departure (departure phase is "
                f"'{PhaseStatus(departure_event.status).value}'). Seal at arrival "
                f"was '{seal_at_arrival or 'none'}'."
            ),
        )
    elif seal_at_arrival is not None and seal_at_arrival != departure_seal:
        # Recorded as evidence, but does NOT hold the trip. This branch used to set
        # trip.status = EXCEPTION_HOLD; three reasons it must not:
        #
        # 1. There is no release or override path anywhere in this codebase. A held
        #    trip could never reach confirmation, so it could never record POD or
        #    anchor its delivery receipt — the hold DESTROYED the remaining evidence
        #    of the very trip whose integrity it was reacting to. On an evidence
        #    platform that is the wrong failure direction: record more, not less.
        # 2. It contradicted _is_resolved, which already treats EXCEPTION as resolved
        #    for gating, precisely so an anomaly is recorded without stopping the
        #    ledger. Holding here re-introduced the blocking behaviour by the back
        #    door, at trip level instead of phase level.
        # 3. Departure's own seal mismatch (advance_departure) has never held the trip. Two
        #    seal mismatches on the same trip behaving differently was inconsistent
        #    with nothing to justify it.
        #
        # The mismatch stays fully visible: the phase row is EXCEPTION and a CRITICAL
        # TripException is written. A dispatcher acts on that, not on a stuck trip.
        # If a hold is ever genuinely wanted it belongs as a manual dispatcher action
        # with an explicit release path — not as an automatic dead end.
        _record_seal_finding(
            db, trip=trip, event=event,
            exception_type=ExceptionType.SEAL_MISMATCH, severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal at arrival ('{seal_at_arrival}') does not match "
                f"the seal applied at departure ('{departure_seal}')."
            ),
        )
    # No LEGACY trip.status assignment here (DEST_GATE_IN is deleted) — the trip
    # simply stays ACTIVE; recompute_position derives the ledger position generically.

    # After every finding above: the anchor fires on EXCEPTION as well as COMPLETED.
    # A seal found broken or wrong is the evidence a dispute turns on, so it is the
    # last row that should go unanchored (departure's precedent).
    _anchor_phase(db, event=event, canonical_payload=compute_arrival_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        seal_number=seal_at_arrival,
        seal_condition=payload.seal_condition.value,
        seal_photo_sha256=artifact_hashes[payload.seal_photo_artifact_id],
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
