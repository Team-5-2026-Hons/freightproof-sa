"""Seed for the Audit Pack integration tests: one realistic two-client JHB → DBN trip.

Anchored P0/P3/P6 with real canonical payloads, photos, a GPS trail with a 47-minute
gap, a reviewed critical panic, and a count mismatch scoped to the second client's
consignment. A plain coroutine, not a fixture, so each test module wraps it in its own
fixture instead of importing one by name (see tests/integration/conftest.py on F811).
"""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.crypto.hashing import compute_trip_canonical_payload
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus,
    BlockchainReceiptType,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    ParcelStatus,
    PhaseStatus,
    PhaseType,
    SubjectType,
    TripStatus,
    VehicleType,
)
from app.db.models.events import VehicleEvent
from app.db.models.evidence import EvidenceArtifact
from app.db.models.locations import TripLocationPing
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_service import (
    compute_confirmation_canonical_payload_v2,
    compute_departure_canonical_payload_v2,
)

T0 = datetime(2026, 9, 12, 6, 0, tzinfo=UTC)
JHB = (Decimal("-26.2041000"), Decimal("28.0473000"))
DBN = (Decimal("-29.8587000"), Decimal("31.0218000"))
PMB = (Decimal("-29.6006000"), Decimal("30.3794000"))
HARRISMITH = (Decimal("-28.2726000"), Decimal("29.1294000"))


def _sha(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


@dataclass
class AuditTrip:
    org: Organization
    dispatcher: User
    trip: Trip
    driver: Driver
    consignment_a: Consignment
    consignment_b: Consignment
    departure: PhaseEvent
    departure_receipt: BlockchainReceipt
    seal_photo: EvidenceArtifact
    panic: TripException
    scoped_mismatch: TripException
    stop_pmb: TripStop


async def _receipt(
    db: AsyncSession, *, trip_id: uuid.UUID, subject_type: SubjectType, subject_id: uuid.UUID,
    receipt_type: BlockchainReceiptType, payload: dict, sequence: int, at: datetime,
) -> BlockchainReceipt:
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip_id, subject_type=subject_type, subject_id=subject_id,
        receipt_type=receipt_type, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.2002", hedera_tx_id=f"0.0.1@{sequence}.0",
        hedera_sequence_number=sequence, hedera_consensus_timestamp=at, payload_json=payload,
    )
    db.add(receipt)
    await db.flush()
    return receipt


def _artifact(trip_id: uuid.UUID, label: str, at: datetime) -> EvidenceArtifact:
    return EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type="photo", s3_key=f"{label}.jpg",
        s3_bucket="evidence", file_hash=_sha(label), mime_type="image/jpeg", captured_at=at,
    )


async def seed_audit_trip(db: AsyncSession) -> AuditTrip:
    org = Organization(id=uuid.uuid4(), name="Load Factor", org_type=OrganizationType.OPERATOR)
    client_a = Organization(id=uuid.uuid4(), name="FedEx", org_type=OrganizationType.PRINCIPAL)
    client_b = Organization(id=uuid.uuid4(), name="Courier Guy", org_type=OrganizationType.PRINCIPAL)
    db.add_all([org, client_a, client_b])
    await db.flush()

    dispatcher = User(id=uuid.uuid4(), organization_id=org.id, email="ops@lfg.co.za", full_name="Ops Desk")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Sipho Driver", id_number="8001015009087",
        phone_number="+27821234567", license_number="DRV-1", license_expiry=date(2027, 1, 1),
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1", make="Volvo", model="FH",
    )
    trailer = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.TRAILER,
        registration="TRL456GP", pulsit_device_id="PUL-2", licence_disc_expiry=date(2026, 1, 1),
    )
    origin = Precinct(id=uuid.uuid4(), name="FedEx JHB", principal_organization_id=client_a.id,
                      latitude=JHB[0], longitude=JHB[1], geofence_radius_metres=300)
    dest = Precinct(id=uuid.uuid4(), name="FedEx DBN", principal_organization_id=client_a.id,
                    latitude=DBN[0], longitude=DBN[1], geofence_radius_metres=300)
    pmb = Precinct(id=uuid.uuid4(), name="Courier Guy PMB", address="1 Church St",
                   principal_organization_id=client_b.id, latitude=PMB[0], longitude=PMB[1])
    db.add_all([dispatcher, driver, horse, trailer, origin, dest, pmb])
    await db.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-AUDIT", order_number="ORD-77",
        operator_organization_id=org.id, client_organization_id=client_a.id, driver_id=driver.id,
        horse_id=horse.id, origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CLOSED, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=dispatcher.id,
        created_at=T0, closed_at=T0 + timedelta(hours=9), trip_type="loaded",
    )
    db.add(trip)
    await db.flush()
    db.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id, pulsit_device_id_snapshot="PUL-2"))

    stop_jhb = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=1)
    stop_dbn = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=2)
    stop_pmb = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=pmb.id, sequence=3)
    db.add_all([stop_jhb, stop_dbn, stop_pmb])
    await db.flush()

    consignment_a = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY-A", client_organization_id=client_a.id,
        declared_value=Decimal("125000.00"), parcel_count_expected=2,
        pickup_stop_id=stop_jhb.id, delivery_stop_id=stop_dbn.id,
    )
    consignment_b = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY-B", client_organization_id=client_b.id,
        parcel_count_expected=1, pickup_stop_id=stop_jhb.id, delivery_stop_id=stop_pmb.id,
    )
    db.add_all([consignment_a, consignment_b])
    await db.flush()
    db.add_all([
        Parcel(id=uuid.uuid4(), consignment_id=consignment_a.id, barcode="A-1", status=ParcelStatus.SCANNED_IN),
        Parcel(id=uuid.uuid4(), consignment_id=consignment_a.id, barcode="A-2", status=ParcelStatus.SCANNED_IN),
        Parcel(id=uuid.uuid4(), consignment_id=consignment_b.id, barcode="B-1", status=ParcelStatus.EXCEPTION),
    ])

    seal_photo = _artifact(trip.id, "seal", T0 + timedelta(hours=2))
    waybill_photo = _artifact(trip.id, "waybill", T0 + timedelta(hours=2))
    pod_photo = _artifact(trip.id, "pod", T0 + timedelta(hours=9))
    pod_signature = _artifact(trip.id, "signature", T0 + timedelta(hours=9))
    selfie = _artifact(trip.id, "selfie", T0 + timedelta(hours=4))
    db.add_all([seal_photo, waybill_photo, pod_photo, pod_signature, selfie])
    await db.flush()

    def phase(seq: int, phase_type: PhaseType, stop: TripStop | None, hours: float, **kw: object) -> PhaseEvent:
        return PhaseEvent(
            id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id if stop else None, phase_type=phase_type,
            sequence_number=seq, status=PhaseStatus.COMPLETED, completed_at=T0 + timedelta(hours=hours), **kw,
        )

    creation = phase(0, PhaseType.TRIP_CREATION, None, 0, anchor_status=AnchorStatus.ANCHORED)
    activation = phase(1, PhaseType.ACTIVATION, stop_jhb, 1,
                       driver_phone_lat=JHB[0], driver_phone_lng=JHB[1], horse_gps_lat=JHB[0], horse_gps_lng=JHB[1])
    loading = phase(2, PhaseType.LOADING, stop_jhb, 1.5, parcel_count_origin=3)
    departure = phase(3, PhaseType.DEPARTURE, stop_jhb, 2, seal_number="SEAL-001",
                      seal_photo_artifact_id=seal_photo.id, waybill_photo_artifact_id=waybill_photo.id,
                      anchor_status=AnchorStatus.ANCHORED)
    in_transit = phase(4, PhaseType.IN_TRANSIT, stop_jhb, 7)
    unloading = phase(5, PhaseType.UNLOADING, stop_dbn, 8.5, seal_number="seal-001")
    confirmation = phase(6, PhaseType.CONFIRMATION, stop_dbn, 9, parcel_count_destination=3,
                         driver_visual_count=3, pod_photo_artifact_id=pod_photo.id,
                         pod_signature_artifact_id=pod_signature.id, anchor_status=AnchorStatus.ANCHORED)
    db.add_all([creation, activation, loading, departure, in_transit, unloading, confirmation])
    await db.flush()

    lock_payload = compute_trip_canonical_payload(
        trip_id=trip.id, order_number=trip.order_number, driver_id=driver.id, horse_id=horse.id,
        trailer_ids=[trailer.id], origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        created_by_user_id=dispatcher.id, created_at=T0, trip_type="loaded",
    )
    creation_receipt = await _receipt(
        db, trip_id=trip.id, subject_type=SubjectType.TRIP, subject_id=trip.id,
        receipt_type=BlockchainReceiptType.JOURNEY_LOCK, payload=lock_payload, sequence=1, at=T0,
    )
    creation.blockchain_receipt_id = creation_receipt.id
    departure_receipt = await _receipt(
        db, trip_id=trip.id, subject_type=SubjectType.PHASE_EVENT, subject_id=departure.id,
        receipt_type=BlockchainReceiptType.PICKUP, sequence=2, at=T0 + timedelta(hours=2),
        payload=compute_departure_canonical_payload_v2(
            phase_event_id=departure.id, trip_id=trip.id, seal_number="SEAL-001",
            seal_photo_sha256=seal_photo.file_hash, waybill_photo_sha256=waybill_photo.file_hash,
        ),
    )
    departure.blockchain_receipt_id = departure_receipt.id
    confirmation_receipt = await _receipt(
        db, trip_id=trip.id, subject_type=SubjectType.PHASE_EVENT, subject_id=confirmation.id,
        receipt_type=BlockchainReceiptType.DELIVERY, sequence=3, at=T0 + timedelta(hours=9),
        payload=compute_confirmation_canonical_payload_v2(
            phase_event_id=confirmation.id, trip_id=trip.id, pp_scan_in_count=3, driver_visual_count=3,
            pod_photo_sha256=pod_photo.file_hash, pod_signature_sha256=pod_signature.file_hash,
        ),
    )
    confirmation.blockchain_receipt_id = confirmation_receipt.id

    db.add(TrailerGpsSnapshot(
        id=uuid.uuid4(), phase_event_id=departure.id, trailer_id=trailer.id, pulsit_device_id="PUL-2",
        lat=JHB[0], lng=JHB[1], captured_at=T0 + timedelta(hours=2),
    ))

    # Pings every 20 min along the N3 (JHB → Harrismith → DBN), with one 47-minute
    # silence after Harrismith — the coverage gap the tests look for.
    route = [JHB, HARRISMITH, DBN]
    ping_times = [T0 + timedelta(hours=1, minutes=20 * i) for i in range(10)]
    ping_times.append(ping_times[-1] + timedelta(minutes=47))
    after_gap = ping_times[-1]
    ping_times.extend(after_gap + timedelta(minutes=20 * i) for i in range(1, 12))
    for i, at in enumerate(ping_times):
        progress = i / (len(ping_times) - 1)
        leg = min(int(progress * 2), 1)
        t = progress * 2 - leg
        start, end = route[leg], route[leg + 1]
        db.add(TripLocationPing(
            id=uuid.uuid4(), trip_id=trip.id, driver_id=driver.id,
            lat=(start[0] + (end[0] - start[0]) * Decimal(str(t))).quantize(Decimal("0.0000001")),
            lng=(start[1] + (end[1] - start[1]) * Decimal(str(t))).quantize(Decimal("0.0000001")),
            accuracy_m=Decimal("12.5"), context="in-transit", recorded_at=at,
        ))

    checkpoint = Checkpoint(
        id=uuid.uuid4(), trip_id=trip.id, checkpoint_type="rest_stop", driver_phone_lat=HARRISMITH[0],
        driver_phone_lng=HARRISMITH[1], driver_captured_at=T0 + timedelta(hours=4), selfie_artifact_id=selfie.id,
        created_at=T0 + timedelta(hours=4),
    )
    db.add(checkpoint)

    panic = TripException(
        id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.PANIC_BUTTON,
        source=ExceptionSource.DRIVER, severity=ExceptionSeverity.CRITICAL, description="Panic held",
        gps_lat=HARRISMITH[0], gps_lng=HARRISMITH[1], created_at=T0 + timedelta(hours=5),
        review_status=ExceptionReviewStatus.REVIEWED, review_outcome="handled_externally",
        reviewed_by_user_id=dispatcher.id, reviewed_at=T0 + timedelta(hours=5, minutes=6),
        contact_method="phone", review_note="Driver safe; false alarm",
    )
    scoped_mismatch = TripException(
        id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING,
        description="WAY-B short one parcel", consignment_id=consignment_b.id,
        created_at=T0 + timedelta(hours=8),
    )
    db.add_all([panic, scoped_mismatch])

    db.add(VehicleEvent(
        id=uuid.uuid4(), vehicle_id=horse.id, event_type="license_plate_changed",
        changed_fields={"registration": {"old": "OLD1GP", "new": "ABC123GP"}},
        changed_by_user_id=dispatcher.id, created_at=T0 + timedelta(hours=3),
    ))
    await db.flush()

    return AuditTrip(
        org=org, dispatcher=dispatcher, trip=trip, driver=driver, consignment_a=consignment_a, consignment_b=consignment_b,
        departure=departure, departure_receipt=departure_receipt, seal_photo=seal_photo,
        panic=panic, scoped_mismatch=scoped_mismatch, stop_pmb=stop_pmb,
    )
