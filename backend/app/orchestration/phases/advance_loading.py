"""The loading phase: origin parcel count and the linehaul sheet, gated on the warehouse scan feed."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import ExceptionSeverity, PhaseStatus
from app.integrations.scan_feed import ScanDirection
from app.orchestration import scan_service
from app.orchestration.evidence import corroboration
from app.orchestration.phases.anchor_dispatch import _anchor_phase
from app.orchestration.phases.artifacts import _assert_artifacts_belong_to_trip
from app.orchestration.phases.completion import _finish_phase
from app.orchestration.phases.driver_position import _record_driver_position
from app.orchestration.phases.findings import _raise_scan_shortfall_if_unrecorded
from app.orchestration.phases.gate import _gate_and_load
from app.orchestration.phases.payloads import compute_loading_canonical_payload_v2
from app.schemas.phases import LoadingCompleteRequest
from app.schemas.trips import TripDetailResponse


async def advance_loading(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, phase_event_id: uuid.UUID,
    payload: LoadingCompleteRequest,
) -> TripDetailResponse:
    gated = await _gate_and_load(
        db, trip_id=trip_id, driver_id=driver_id, phase_event_id=phase_event_id,
        phase_label="Loading",
    )
    if isinstance(gated, TripDetailResponse):
        return gated
    trip, event = gated

    _record_driver_position(event, payload)
    horse_fix = await corroboration.record_phase_corroboration(
        db, trip=trip, event=event, driver_captured_at=payload.driver_captured_at,
    )

    # Optional evidence: a warehouse that has already gone paperless has no linehaul
    # sheet to hand the driver, and this must never block completion (schema docstring).
    linehaul_photo_sha256: str | None = None
    if payload.linehaul_photo_artifact_id is not None:
        linehaul_hashes = await _assert_artifacts_belong_to_trip(
            db, trip_id=trip_id, artifact_ids=(payload.linehaul_photo_artifact_id,),
        )
        event.linehaul_photo_artifact_id = payload.linehaul_photo_artifact_id
        linehaul_photo_sha256 = linehaul_hashes[payload.linehaul_photo_artifact_id]

    # The observed set, not a driver-entered number. The gate in _gate_and_load has
    # already established that the warehouse closed its session at this stop, so these
    # counts are final for this loading — which is what makes stamping the aggregate
    # here safe under the "anchored payload contains only data that existed at close"
    # rule. driver_visual_count is accepted on the payload (schema) but
    # deliberately never read here — see LoadingCompleteRequest's docstring.
    #
    # trip_stop_id is Optional on PhaseEvent (only TRIP_CREATION is ever NULL, per
    # its own uq_phase_events_trip_stop_type comment) — a LOADING row always carries
    # one, so the None branch is unreachable in practice. Narrowed explicitly rather
    # than asserted, since scan_service.load_consignments_at_stop requires a UUID.
    consignments = (
        await scan_service.load_consignments_at_stop(
            db, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
            direction=ScanDirection.OUT,
        )
        if event.trip_stop_id is not None
        else []
    )

    scanned_out_total = 0
    expected_total = 0
    shortfall_recorded = False
    for consignment in consignments:
        counts = await scan_service.scanned_counts_for_consignment(
            db, consignment_id=consignment.id,
        )
        scanned_out_total += counts.scanned_out
        expected_total += counts.expected

        if counts.scanned_out != counts.expected:
            # BACKSTOP ONLY — scan_service._reconcile_consignment is the primary
            # writer of this exception and it already fired at ingest, naming the
            # missing barcodes. Raising unconditionally here would put TWO rows on
            # the dispatcher's list for one short count: scan_service's dedup
            # compares descriptions verbatim, so a differently-worded second row
            # sails straight past it.
            #
            # The one case scan_service genuinely cannot cover: it guards on
            # `if events and (missing or unexpected)`, so a session closed with
            # NOTHING scanned at all raises nothing there — no events, no row. That
            # is the most serious short count there is and it must not go unrecorded.
            # Hence a presence check rather than an unconditional add.
            shortfall_recorded |= await _raise_scan_shortfall_if_unrecorded(
                db, trip_id=trip_id, event=event, consignment=consignment,
                scanned_out=counts.scanned_out, expected=counts.expected,
            )

    if shortfall_recorded:
        # After the loop, and only for rows this call actually wrote — the helper
        # suppresses duplicates of what scan_service already raised at ingest, and a
        # suppressed duplicate is not news to the dispatcher.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(ExceptionSeverity.WARNING),
            ),
        )

    # None, not 0, when this stop has no consignments at all: a trip created without
    # a Parcel Perfect reference has no manifest baseline, and 0 would read as
    # "nothing was loaded" rather than "nothing was declared". Same None-is-not-zero
    # principle as the old _expected_parcel_count (removed by this task — advance_loading
    # was its only caller).
    event.parcel_count_origin = scanned_out_total if consignments else None

    # A short scan is recorded, never blocking — FreightProof records what happened,
    # it does not dispatch. Matches departure's and unloading's seal-mismatch precedent.
    event.status = (
        PhaseStatus.EXCEPTION
        if consignments and scanned_out_total != expected_total
        else PhaseStatus.COMPLETED
    )

    _anchor_phase(db, event=event, canonical_payload=compute_loading_canonical_payload_v2(
        phase_event_id=event.id, trip_id=trip_id,
        parcel_count_origin=event.parcel_count_origin,
        linehaul_photo_sha256=linehaul_photo_sha256,
    ))

    return await _finish_phase(
        db, trip=trip, event=event, idempotency_key=payload.idempotency_key,
        horse_fix=horse_fix, driver_accuracy_metres=payload.driver_accuracy_metres,
    )
