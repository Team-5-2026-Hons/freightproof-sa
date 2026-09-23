"""Assemble an Audit Pack manifest for one trip, or one consignment on it.

Read-only: loads the trip's evidence graph in a fixed number of queries (no per-row
lookups, so a 3,000-ping trip costs the same round trips as a 3-ping one), then hands
plain values to the pure functions in audit_pack_analysis.

Redaction happens here, at assembly, not in the renderers — a field that never enters
the manifest cannot leak through a template bug.
"""

import logging
import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import canonicalize_payload, compute_payload_hash
from app.core.exceptions import ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, PhaseType, VehicleEventType, enum_text
from app.db.models.events import DriverEvent, VehicleEvent
from app.db.models.evidence import EvidenceArtifact
from app.db.models.locations import TripLocationPing
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Consignment, DriverSubstitution, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.core.display import DISPLAY_TIMEZONE
from app.orchestration.incident_declaration_service import load_declarations
from app.orchestration.audit_pack_analysis import (
    derive_observations,
    find_coverage_gaps,
    find_stationary_periods,
    is_valid_on,
    mask_id_number,
    summarise_incident,
)
from app.schemas.action_location import ActionLocationAssessment
from app.schemas.audit_pack import (
    AnchoredField,
    AnchoredRecord,
    AuditPackManifest,
    AuditPackOptions,
    CheckpointRecord,
    ConsignmentRecord,
    DriverRecord,
    DriverSubstitutionRecord,
    EvidenceFile,
    EvidenceRole,
    EvidenceTier,
    ExceptionRecord,
    LocationCoverage,
    ParcelRecord,
    PhaseRecord,
    PositionFix,
    PositionSource,
    RecordChange,
    StopRecord,
    TripSummary,
    VehicleRecord,
)

logger = logging.getLogger(__name__)

# Shown in place of a stop that serves only other clients in a consignment-scoped pack:
# the route shape stays visible (custody runs through it), whose depot it is does not.
REDACTED_STOP_NAME = "Other stop on route"

# Anchored payload key → PhaseEvent attribute it committed (phase_service v2 payloads).
_ANCHORED_PHASE_FIELDS: Mapping[str, str] = {
    "seal_number": "seal_number",
    "pp_scan_in_count": "parcel_count_destination",
    "driver_visual_count": "driver_visual_count",
}
_COUNT_FIELDS = frozenset({"parcel_count_destination", "driver_visual_count", "parcel_count_origin"})

# Evidence role → (PhaseEvent FK attribute, anchored payload key or None when that role
# is never committed by any receipt, so it can only ever be "recorded").
_PHASE_EVIDENCE: Mapping[EvidenceRole, tuple[str, str | None]] = {
    "seal_photo": ("seal_photo_artifact_id", "seal_photo_sha256"),
    "waybill_photo": ("waybill_photo_artifact_id", "waybill_photo_sha256"),
    "gate_photo": ("gate_photo_artifact_id", None),
    "pod_photo": ("pod_photo_artifact_id", "pod_photo_sha256"),
    "pod_signature": ("pod_signature_artifact_id", "pod_signature_sha256"),
    "linehaul_photo": ("linehaul_photo_artifact_id", None),
}


def _f(value: Decimal | float | None) -> float | None:
    return float(value) if value is not None else None


def _fix(
    lat: Decimal | float | None, lng: Decimal | float | None, source: PositionSource,
    recorded_at: datetime | None, accuracy: Decimal | float | None = None,
) -> PositionFix | None:
    if lat is None or lng is None:
        return None
    return PositionFix(
        lat=float(lat), lng=float(lng), source=source, recorded_at=recorded_at,
        accuracy_metres=_f(accuracy),
    )


def _assessment(raw: Any, *, owner_id: uuid.UUID) -> ActionLocationAssessment | None:
    """Validated like every other read of this column (schemas/phases.py). A stored
    snapshot that no longer validates is left out and logged, never guessed at."""
    if raw is None:
        return None
    try:
        return ActionLocationAssessment.model_validate(raw)
    except ValidationError:
        logger.warning("Stored action_location_assessment failed validation for %s; omitted from pack", owner_id)
        return None


def _anchored_record(receipt: BlockchainReceipt) -> AnchoredRecord:
    canonical = canonicalize_payload(receipt.payload_json)
    return AnchoredRecord(
        receipt_id=receipt.id,
        subject_type=enum_text(receipt.subject_type),
        subject_id=receipt.subject_id,
        receipt_type=enum_text(receipt.receipt_type),
        canonical_payload=canonical,
        data_hash=receipt.data_hash,
        hedera_topic_id=receipt.hedera_topic_id,
        hedera_sequence_number=receipt.hedera_sequence_number,
        hedera_tx_id=receipt.hedera_tx_id,
        hedera_consensus_at=receipt.hedera_consensus_timestamp,
        payload_matches_hash=compute_payload_hash(receipt.payload_json) == receipt.data_hash,
    )


def _evidence(
    artifact: EvidenceArtifact, role: EvidenceRole, *, anchored_hash: str | None = None,
) -> EvidenceFile:
    tier: EvidenceTier = "anchored" if anchored_hash is not None and anchored_hash == artifact.file_hash else "recorded"
    return EvidenceFile(
        artifact_id=artifact.id, role=role, sha256=artifact.file_hash, mime_type=artifact.mime_type,
        captured_at=artifact.captured_at, tier=tier,
    )


def _phase_record(
    event: PhaseEvent,
    *,
    stop: StopRecord | None,
    receipt: BlockchainReceipt | None,
    artifacts: Mapping[uuid.UUID, EvidenceArtifact],
    trailer_snapshots: Sequence[TrailerGpsSnapshot],
    withhold_counts: bool,
) -> PhaseRecord:
    assessment = _assessment(event.action_location_assessment, owner_id=event.id)
    # Only a receipt the ledger itself says landed counts — AnchorStatus warns never to
    # render a pending or failed anchor as success.
    anchored = receipt is not None and event.anchor_status == AnchorStatus.ANCHORED
    payload: Mapping[str, Any] = receipt.payload_json if anchored and receipt is not None else {}

    counts = {
        name: (None if withhold_counts else getattr(event, name)) for name in _COUNT_FIELDS
    }

    anchored_fields: list[AnchoredField] = []
    for key, attribute in _ANCHORED_PHASE_FIELDS.items():
        if key not in payload or (withhold_counts and attribute in _COUNT_FIELDS):
            continue
        value = getattr(event, attribute)
        anchored_fields.append(AnchoredField(name=key, value=value, matches_anchor=payload[key] == value))

    evidence: list[EvidenceFile] = []
    for role, (attribute, payload_key) in _PHASE_EVIDENCE.items():
        artifact_id = getattr(event, attribute)
        artifact = artifacts.get(artifact_id) if artifact_id is not None else None
        committed = payload.get(payload_key) if payload_key is not None else None
        if artifact is not None:
            evidence.append(_evidence(artifact, role, anchored_hash=committed))
        if payload_key is not None and payload_key in payload:
            current = artifact.file_hash if artifact is not None else None
            anchored_fields.append(AnchoredField(name=payload_key, value=current, matches_anchor=current == committed))

    if anchored:
        tier: EvidenceTier = "anchored"
    elif assessment is not None and assessment.proximity == "within_limit":
        tier = "corroborated"
    else:
        tier = "recorded"

    tracker_at = assessment.tracker_captured_at if assessment is not None else None
    driver_accuracy = assessment.driver_accuracy_metres if assessment is not None else None
    trailer_fixes = [
        PositionFix(lat=float(s.lat), lng=float(s.lng), source="trailer_tracker", recorded_at=s.captured_at)
        for s in trailer_snapshots
    ]

    return PhaseRecord(
        phase_event_id=event.id,
        sequence_number=event.sequence_number,
        phase_type=enum_text(event.phase_type),
        status=enum_text(event.status),
        anchor_status=enum_text(event.anchor_status),
        trip_stop_id=event.trip_stop_id,
        precinct_name=stop.precinct_name if stop is not None else None,
        slot_time=stop.slot_time if stop is not None else None,
        completed_at=event.completed_at,
        driver_captured_at=event.driver_captured_at,
        driver_phone=_fix(event.driver_phone_lat, event.driver_phone_lng, "driver_phone",
                          event.driver_captured_at, driver_accuracy),
        vehicle_tracker=_fix(event.horse_gps_lat, event.horse_gps_lng, "vehicle_tracker", tracker_at),
        trailer_fixes=trailer_fixes,
        location_assessment=assessment,
        location_warning_acknowledged_at=event.location_warning_acknowledged_at,
        location_warning_reason=event.location_warning_reason,
        overridden_by_dispatcher=event.dispatcher_override_user_id is not None,
        override_note=event.dispatcher_override_note,
        seal_number=event.seal_number,
        parcel_count_origin=counts["parcel_count_origin"],
        parcel_count_destination=counts["parcel_count_destination"],
        driver_visual_count=counts["driver_visual_count"],
        evidence=evidence,
        anchored_fields=anchored_fields,
        anchor_receipt_id=receipt.id if receipt is not None else None,
        tier=tier,
    )


def _checkpoint_evidence(
    checkpoint: Checkpoint, artifacts: Mapping[uuid.UUID, EvidenceArtifact],
) -> list[EvidenceFile]:
    pairs: tuple[tuple[uuid.UUID | None, EvidenceRole], ...] = (
        (checkpoint.selfie_artifact_id, "checkpoint_selfie"),
        (checkpoint.cargo_photo_artifact_id, "checkpoint_cargo_photo"),
    )
    return [
        _evidence(artifacts[artifact_id], role)
        for artifact_id, role in pairs
        if artifact_id is not None and artifact_id in artifacts
    ]


def _changed_field_names(changed: Any) -> list[str]:
    return sorted(changed) if isinstance(changed, dict) else []


def _record_changes(
    vehicle_events: Iterable[VehicleEvent], driver_events: Iterable[DriverEvent],
) -> list[RecordChange]:
    changes = [
        RecordChange(
            subject="vehicle", subject_id=e.vehicle_id, event_type=e.event_type,
            changed_fields=_changed_field_names(e.changed_fields), changed_at=e.created_at,
            anchor_receipt_id=e.blockchain_receipt_id,
            tier="anchored" if e.blockchain_receipt_id is not None else "recorded",
        )
        for e in vehicle_events
    ]
    changes.extend(
        RecordChange(
            subject="driver", subject_id=e.driver_id, event_type=e.event_type,
            changed_fields=_changed_field_names(e.changed_fields), changed_at=e.created_at,
            anchor_receipt_id=e.blockchain_receipt_id,
            tier="anchored" if e.blockchain_receipt_id is not None else "recorded",
        )
        for e in driver_events
    )
    return sorted(changes, key=lambda c: c.changed_at)


async def build_audit_manifest(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    operator_organization_id: uuid.UUID,
    options: AuditPackOptions,
    generated_at: datetime | None = None,
) -> AuditPackManifest:
    """Snapshot everything an insurer, adjuster or detective needs about one trip.

    Raises ResourceNotFoundError when the trip is not this operator's, or when the
    requested consignment scope is not on the trip.
    """
    generated_at = generated_at or datetime.now(UTC)

    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == operator_organization_id)
    )).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    consignments = list((await db.execute(
        select(Consignment).where(Consignment.trip_id == trip.id).order_by(Consignment.parcel_perfect_reference)
    )).scalars())
    scope_id = options.scope_consignment_id
    if scope_id is not None and scope_id not in {c.id for c in consignments}:
        raise ResourceNotFoundError("Consignment", str(scope_id))
    in_scope = [c for c in consignments if scope_id is None or c.id == scope_id]
    out_of_scope = [c for c in consignments if c not in in_scope]

    parcels = list((await db.execute(
        select(Parcel).where(Parcel.consignment_id.in_([c.id for c in in_scope])).order_by(Parcel.barcode)
    )).scalars()) if in_scope else []

    stop_rows = (await db.execute(
        select(TripStop, Precinct).join(Precinct, Precinct.id == TripStop.precinct_id)
        .where(TripStop.trip_id == trip.id).order_by(TripStop.sequence)
    )).all()

    phases = list((await db.execute(
        select(PhaseEvent).where(PhaseEvent.trip_id == trip.id).order_by(PhaseEvent.sequence_number)
    )).scalars())
    snapshots = list((await db.execute(
        select(TrailerGpsSnapshot).where(TrailerGpsSnapshot.phase_event_id.in_([p.id for p in phases]))
    )).scalars()) if phases else []

    checkpoints = list((await db.execute(
        select(Checkpoint).where(Checkpoint.trip_id == trip.id).order_by(Checkpoint.created_at)
    )).scalars())

    exceptions = [
        e for e in (await db.execute(
            select(TripException).where(TripException.trip_id == trip.id).order_by(TripException.created_at)
        )).scalars()
        # Trip-level exceptions (no consignment) stay in every scope: a hijack affects all
        # cargo on the truck. Only rows pinned to ANOTHER client's consignment are cut.
        if scope_id is None or e.consignment_id is None or e.consignment_id == scope_id
    ]

    substitutions = list((await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == trip.id)
        .order_by(DriverSubstitution.substitution_at)
    )).scalars())
    driver_ids = {trip.driver_id} | {s.original_driver_id for s in substitutions} | {
        s.substituting_driver_id for s in substitutions
    }
    drivers = {d.id: d for d in (await db.execute(select(Driver).where(Driver.id.in_(driver_ids)))).scalars()}

    trailer_rows = (await db.execute(
        select(Vehicle).join(TripTrailer, TripTrailer.trailer_id == Vehicle.id)
        .where(TripTrailer.trip_id == trip.id).order_by(Vehicle.registration)
    )).scalars()
    trailers = list(trailer_rows)
    horse = (await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))).scalar_one()

    window_start = min(
        (p.completed_at for p in phases if p.completed_at is not None and p.phase_type != PhaseType.TRIP_CREATION),
        default=None,
    )
    # A trip that never closed (the hijack case) is judged up to the moment of issue —
    # "no position since" is exactly what an adjuster needs to see.
    window_end = trip.closed_at or generated_at

    vehicle_ids = [horse.id, *(t.id for t in trailers)]
    vehicle_events = list((await db.execute(
        select(VehicleEvent).where(
            VehicleEvent.vehicle_id.in_(vehicle_ids),
            VehicleEvent.event_type != VehicleEventType.CREATED.value,
            VehicleEvent.created_at >= trip.created_at, VehicleEvent.created_at <= window_end,
        )
    )).scalars())
    driver_events = list((await db.execute(
        select(DriverEvent).where(
            DriverEvent.driver_id.in_(driver_ids),
            DriverEvent.event_type != "created",
            DriverEvent.created_at >= trip.created_at, DriverEvent.created_at <= window_end,
        )
    )).scalars())

    linked_receipt_ids = {
        r for r in (
            *(e.blockchain_receipt_id for e in vehicle_events),
            *(e.blockchain_receipt_id for e in driver_events),
            *(s.blockchain_receipt_id for s in substitutions),
        ) if r is not None
    }
    receipt_filter = BlockchainReceipt.trip_id == trip.id
    if linked_receipt_ids:
        receipt_filter = or_(receipt_filter, BlockchainReceipt.id.in_(linked_receipt_ids))
    receipts = list((await db.execute(
        select(BlockchainReceipt).where(receipt_filter)
        .order_by(BlockchainReceipt.hedera_consensus_timestamp, BlockchainReceipt.created_at)
    )).scalars())
    receipts_by_id = {r.id: r for r in receipts}

    artifact_ids = {
        a for a in (
            *(getattr(p, attribute) for p in phases for attribute, _ in _PHASE_EVIDENCE.values()),
            *(c.selfie_artifact_id for c in checkpoints),
            *(c.cargo_photo_artifact_id for c in checkpoints),
            *(e.supporting_artifact_id for e in exceptions),
        ) if a is not None
    }
    artifacts = {
        a.id: a for a in (await db.execute(
            select(EvidenceArtifact).where(EvidenceArtifact.id.in_(artifact_ids), EvidenceArtifact.trip_id == trip.id)
        )).scalars()
    } if artifact_ids else {}

    pings = list((await db.execute(
        select(TripLocationPing).where(TripLocationPing.trip_id == trip.id).order_by(TripLocationPing.recorded_at)
    )).scalars())

    org_ids = {trip.operator_organization_id} | {
        c.client_organization_id for c in consignments if c.client_organization_id is not None
    }
    if trip.client_organization_id is not None:
        org_ids.add(trip.client_organization_id)
    orgs = {o.id: o for o in (await db.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars()}

    user_ids = {e.reviewed_by_user_id for e in exceptions if e.reviewed_by_user_id is not None}
    users = {
        u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars()
    } if user_ids else {}

    # ── Scope: which stops and counts belong to someone else ────────────────────
    redactions: list[str] = ["Driver phone number withheld."]
    if scope_id is not None:
        scoped = in_scope[0]
        visible_stop_ids = {scoped.pickup_stop_id, scoped.delivery_stop_id}
        shared_stop_ids = {c.pickup_stop_id for c in out_of_scope} | {c.delivery_stop_id for c in out_of_scope}
        redactions.extend([
            f"Scoped to consignment {scoped.parcel_perfect_reference}: other clients' consignments, "
            "parcels, consignment-specific exceptions and stop names are withheld.",
            "Stop-level parcel counts that include other clients' cargo are withheld.",
            "Anchored payloads are reproduced verbatim so they can be verified; they may contain "
            "stop-level totals.",
        ])
        client_ids = [scoped.client_organization_id] if scoped.client_organization_id else []
    else:
        visible_stop_ids = {stop.id for stop, _ in stop_rows}
        shared_stop_ids = set()
        client_ids = sorted(
            {c.client_organization_id for c in consignments if c.client_organization_id is not None}
            | ({trip.client_organization_id} if trip.client_organization_id else set()),
            key=str,
        )

    stops: dict[uuid.UUID, StopRecord] = {}
    for stop, precinct in stop_rows:
        visible = stop.id in visible_stop_ids
        stops[stop.id] = StopRecord(
            trip_stop_id=stop.id, sequence=stop.sequence, precinct_id=precinct.id,
            precinct_name=precinct.name if visible else REDACTED_STOP_NAME,
            address=precinct.address if visible else None,
            lat=float(precinct.latitude), lng=float(precinct.longitude),
            geofence_radius_metres=precinct.geofence_radius_metres, slot_time=stop.slot_time,
        )

    # ── Records ────────────────────────────────────────────────────────────────
    snapshots_by_phase: dict[uuid.UUID, list[TrailerGpsSnapshot]] = {}
    for snapshot in snapshots:
        snapshots_by_phase.setdefault(snapshot.phase_event_id, []).append(snapshot)

    phase_records = [
        _phase_record(
            event,
            stop=stops.get(event.trip_stop_id) if event.trip_stop_id else None,
            receipt=receipts_by_id.get(event.blockchain_receipt_id) if event.blockchain_receipt_id else None,
            artifacts=artifacts,
            trailer_snapshots=snapshots_by_phase.get(event.id, []),
            withhold_counts=event.trip_stop_id in shared_stop_ids,
        )
        for event in phases
    ]

    checkpoint_records = [
        CheckpointRecord(
            checkpoint_id=c.id, checkpoint_type=c.checkpoint_type, recorded_at=c.created_at,
            driver_phone=_fix(c.driver_phone_lat, c.driver_phone_lng, "driver_phone",
                              c.driver_captured_at or c.created_at),
            vehicle_tracker=_fix(c.horse_gps_lat, c.horse_gps_lng, "vehicle_tracker", None),
            is_deviation=c.is_deviation, note=c.note,
            evidence=_checkpoint_evidence(c, artifacts),
            tier="recorded",
        )
        for c in checkpoints
    ]

    exception_records = [
        ExceptionRecord(
            exception_id=e.id, exception_type=enum_text(e.exception_type), source=enum_text(e.source),
            severity=enum_text(e.severity), description=e.description, raised_at=e.created_at,
            position=_fix(e.gps_lat, e.gps_lng, "driver_phone", e.created_at),
            phase_event_id=e.phase_event_id, checkpoint_id=e.checkpoint_id, consignment_id=e.consignment_id,
            review_status=enum_text(e.review_status),
            review_outcome=enum_text(e.review_outcome) if e.review_outcome is not None else None,
            reviewed_at=e.reviewed_at,
            reviewer_name=users[e.reviewed_by_user_id].full_name if e.reviewed_by_user_id in users else None,
            contact_method=enum_text(e.contact_method) if e.contact_method is not None else None,
            review_note=e.review_note,
            evidence=[_evidence(artifacts[e.supporting_artifact_id], "exception_supporting")]
            if e.supporting_artifact_id in artifacts else [],
            # Exceptions are not anchored today (plan Stage 8) — never claim more.
            tier="recorded",
        )
        for e in exceptions
    ]

    # ── Location ───────────────────────────────────────────────────────────────
    all_fixes: list[PositionFix] = [
        PositionFix(lat=float(p.lat), lng=float(p.lng), source="driver_phone",
                    recorded_at=p.recorded_at, accuracy_metres=_f(p.accuracy_m))
        for p in pings
    ]
    for record in phase_records:
        all_fixes.extend(f for f in (record.driver_phone, record.vehicle_tracker) if f is not None)
        all_fixes.extend(record.trailer_fixes)
    for checkpoint in checkpoint_records:
        all_fixes.extend(f for f in (checkpoint.driver_phone, checkpoint.vehicle_tracker) if f is not None)
    all_fixes.extend(e.position for e in exception_records if e.position is not None)
    all_fixes.sort(key=lambda f: (f.recorded_at is None, f.recorded_at or generated_at))

    fix_counts: dict[PositionSource, int] = {}
    for fix in all_fixes:
        fix_counts[fix.source] = fix_counts.get(fix.source, 0) + 1
    fix_times = [f.recorded_at for f in all_fixes if f.recorded_at is not None]

    if options.include_location_trail:
        trail = all_fixes
        stationary = find_stationary_periods(all_fixes, stops=list(stops.values()))
    else:
        trail, stationary = [], []
        redactions.append(
            "Location trail and stationary periods withheld at the issuer's request; "
            "coverage gaps are still reported."
        )

    coverage = LocationCoverage(
        window_start=window_start, window_end=window_end if window_start is not None else None,
        fix_counts=fix_counts,
        first_fix_at=min(fix_times, default=None), last_fix_at=max(fix_times, default=None),
        gaps=find_coverage_gaps(fix_times, window_start=window_start, window_end=window_end),
        stationary_periods=stationary,
    )

    # ── People and vehicles ────────────────────────────────────────────────────
    trip_date = trip.created_at.astimezone(DISPLAY_TIMEZONE).date()
    driver = drivers[trip.driver_id]
    if not options.include_full_driver_id:
        redactions.append("Driver identity number masked to its last 4 digits.")

    def vehicle_record(vehicle: Vehicle, role: str) -> VehicleRecord:
        return VehicleRecord(
            vehicle_id=vehicle.id, role="horse" if role == "horse" else "trailer",
            registration=vehicle.registration, vehicle_type=enum_text(vehicle.vehicle_type),
            make=vehicle.make, model=vehicle.model, year=vehicle.year, vin_number=vehicle.vin_number,
            licence_disc_expiry=vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
            licence_disc_valid_on_trip_date=is_valid_on(vehicle.licence_disc_expiry, trip_date),
            tracker_device_id=vehicle.pulsit_device_id,
        )

    substitution_records = [
        DriverSubstitutionRecord(
            substitution_id=s.id,
            original_driver_name=drivers[s.original_driver_id].full_name,
            substituting_driver_name=drivers[s.substituting_driver_id].full_name,
            exchange_location=s.exchange_location, is_planned=s.is_planned, substitution_at=s.substitution_at,
            anchor_receipt_id=s.blockchain_receipt_id,
            tier="anchored" if s.blockchain_receipt_id is not None else "recorded",
        )
        for s in substitutions
    ]

    parcels_by_consignment: dict[uuid.UUID, list[ParcelRecord]] = {}
    for parcel in parcels:
        parcels_by_consignment.setdefault(parcel.consignment_id, []).append(ParcelRecord(
            barcode=parcel.barcode, status=enum_text(parcel.status),
            pp_scan_out_at=parcel.pp_scan_out_at, pp_scan_in_at=parcel.pp_scan_in_at,
        ))

    included_exception_ids = {e.exception_id for e in exception_records}
    declarations = [
        d for d in await load_declarations(db, trip_id=trip.id)
        # A declaration pinned to an exception cut by scope goes with it.
        if d.exception_id is None or d.exception_id in included_exception_ids
    ]

    manifest = AuditPackManifest(
        generated_at=generated_at,
        options=options,
        trip=TripSummary(
            trip_id=trip.id, trip_reference=trip.trip_reference, order_number=trip.order_number,
            trip_type=trip.trip_type, status=enum_text(trip.status),
            operator_name=orgs[trip.operator_organization_id].name,
            client_names=[orgs[i].name for i in client_ids if i in orgs],
            pulsit_trip_reference_id=trip.pulsit_trip_reference_id, journey_lock_hash=trip.journey_lock_hash,
            created_at=trip.created_at, planned_departure_at=trip.planned_departure_at,
            planned_arrival_at=trip.planned_arrival_at, actual_departure_at=trip.actual_departure_at,
            actual_arrival_at=trip.actual_arrival_at, closed_at=trip.closed_at,
        ),
        stops=list(stops.values()),
        vehicles=[vehicle_record(horse, "horse"), *(vehicle_record(t, "trailer") for t in trailers)],
        driver=DriverRecord(
            driver_id=driver.id, full_name=driver.full_name,
            id_number=driver.id_number if options.include_full_driver_id else mask_id_number(driver.id_number),
            id_number_masked=not options.include_full_driver_id,
            license_number=driver.license_number,
            license_expiry=driver.license_expiry.isoformat() if driver.license_expiry else None,
            license_valid_on_trip_date=is_valid_on(driver.license_expiry, trip_date),
            trip_idvs_status=enum_text(trip.idvs_check_status), trip_idvs_checked_at=trip.idvs_checked_at,
            substitutions=substitution_records,
        ),
        consignments=[
            ConsignmentRecord(
                consignment_id=c.id, parcel_perfect_reference=c.parcel_perfect_reference,
                client_name=orgs[c.client_organization_id].name if c.client_organization_id in orgs else None,
                declared_value=c.declared_value, parcel_count_expected=c.parcel_count_expected,
                unit_count_expected=c.unit_count_expected, pickup_stop_id=c.pickup_stop_id,
                delivery_stop_id=c.delivery_stop_id, parcels=parcels_by_consignment.get(c.id, []),
            )
            for c in in_scope
        ],
        phases=phase_records,
        checkpoints=checkpoint_records,
        exceptions=exception_records,
        record_changes=_record_changes(vehicle_events, driver_events),
        location_trail=trail,
        location_coverage=coverage,
        anchored_records=[_anchored_record(r) for r in receipts],
        # From every fix, trail included or not: the last known position is the one
        # location fact a claim form and a SAPS docket cannot do without.
        incident=summarise_incident(exception_records, fixes=all_fixes),
        declarations=declarations,
        observations=[],
        redactions=redactions,
    )
    return manifest.model_copy(update={"observations": derive_observations(manifest)})

