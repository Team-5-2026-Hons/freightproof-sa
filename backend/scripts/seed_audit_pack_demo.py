"""Seed ONE realistic, genuinely anchored trip into a LOCAL database, for trying the
insurer audit pack end to end (dispatcher "Audit packs" tab → share link → client portal).

What it creates, in the DEMO_MODE organisation (so a local backend run with
DEMO_MODE=true can see and issue packs for it):
  * a two-client JHB → DBN trip with 7 completed phases, stops and consignments;
  * real photos (seal, waybill, POD, signature, selfie) uploaded to Supabase Storage
    under the trip's id, so the portal can show them and re-hash their bytes;
  * the journey lock (P0), departure (P3) and confirmation (P6) ANCHORED on Hedera
    testnet for real, so browser verification genuinely checks against the ledger;
  * a GPS trail with a 47-minute gap, a checkpoint, a reviewed critical panic, and a
    count-mismatch exception scoped to the second client.

It builds its own schema with create_all — a throwaway local database, never the shared
one. It refuses to run unless DATABASE_URL points at localhost.

Side effects outside your machine: ~5 small JPEGs in the `evidence-artifacts` bucket and
3 messages on the Hedera testnet topic. Safe to run more than once (each run adds a new
trip; reference rows are reused).

Usage:
    cd backend
    DATABASE_URL=postgresql+asyncpg://$USER@localhost:5433/freightproof_audit_local \\
      PYTHONPATH=. .venv/bin/python scripts/seed_audit_pack_demo.py
"""

import asyncio
import io
import sys
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.blockchain.anchor_service import anchor_subject
from app.core.config import settings
from app.crypto.hashing import compute_trip_canonical_payload
from app.db.models import Base
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
from app.db.models.evidence import EvidenceArtifact
from app.db.models.locations import TripLocationPing
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phase_service import (
    compute_confirmation_canonical_payload_v2,
    compute_departure_canonical_payload_v2,
)
from app.storage.supabase_storage import upload_evidence_file

# The DEMO_MODE identity (app/auth/dependencies.py): a local backend run with
# DEMO_MODE=true acts as this admin dispatcher in this organisation.
_DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
_DEMO_ORG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")

_LOCAL_HOSTS = ("localhost", "127.0.0.1")

JHB = (Decimal("-26.2041000"), Decimal("28.0473000"))
HARRISMITH = (Decimal("-28.2726000"), Decimal("29.1294000"))
DBN = (Decimal("-29.8587000"), Decimal("31.0218000"))
PMB = (Decimal("-29.6006000"), Decimal("30.3794000"))

# Driver-phone pings every 20 min, with one 47-minute silence — the gap the pack reports.
PING_INTERVAL = timedelta(minutes=20)
GAP = timedelta(minutes=47)


def _photo(label: str, colour: tuple[int, int, int]) -> bytes:
    """A small labelled JPEG standing in for an evidence photo."""
    image = Image.new("RGB", (640, 480), colour)
    ImageDraw.Draw(image).text((24, 24), label, fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


async def _get_or_add(db: AsyncSession, model: type[Any], row_id: uuid.UUID, **fields: Any) -> Any:
    existing = (await db.execute(select(model).where(model.id == row_id))).scalar_one_or_none()
    if existing is not None:
        return existing
    row = model(id=row_id, **fields)
    db.add(row)
    await db.flush()
    return row


async def _artifact(db: AsyncSession, trip_id: uuid.UUID, label: str, colour: tuple[int, int, int],
                    at: datetime) -> EvidenceArtifact:
    uploaded = await upload_evidence_file(trip_id=str(trip_id), file_bytes=_photo(label, colour), mime_type="image/jpeg")
    row = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type="photo", s3_key=uploaded.s3_key,
        s3_bucket=uploaded.s3_bucket, file_hash=uploaded.file_hash, mime_type="image/jpeg", captured_at=at,
    )
    db.add(row)
    await db.flush()
    return row


async def seed(db: AsyncSession) -> Trip:
    now = datetime.now(UTC).replace(microsecond=0)
    t0 = now - timedelta(days=1)

    operator = await _get_or_add(db, Organization, _DEMO_ORG_ID, name="Load Factor (demo)",
                                 org_type=OrganizationType.OPERATOR)
    dispatcher = await _get_or_add(db, User, _DEMO_USER_ID, organization_id=operator.id,
                                   email="demo-dispatcher@freightproof.co.za", full_name="Demo Dispatcher")
    suffix = uuid.uuid4().hex[:6].upper()
    client_a = Organization(id=uuid.uuid4(), name="FedEx", org_type=OrganizationType.PRINCIPAL)
    client_b = Organization(id=uuid.uuid4(), name="Courier Guy", org_type=OrganizationType.PRINCIPAL)
    db.add_all([client_a, client_b])
    await db.flush()

    driver = Driver(id=uuid.uuid4(), organization_id=operator.id, full_name="Sipho Dlamini",
                    id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{suffix}",
                    license_expiry=date(now.year + 1, 1, 31))
    horse = Vehicle(id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.HORSE,
                    registration=f"FP{suffix}GP", pulsit_device_id=f"PUL-H-{suffix}", make="Volvo", model="FH",
                    year=2021, vin_number="YV2RT40A5LB123456")
    trailer = Vehicle(id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.TRAILER,
                      registration=f"TR{suffix}GP", pulsit_device_id=f"PUL-T-{suffix}",
                      licence_disc_expiry=date(now.year + 1, 3, 31))
    origin = Precinct(id=uuid.uuid4(), name="FedEx JHB Hub", principal_organization_id=client_a.id,
                      latitude=JHB[0], longitude=JHB[1], geofence_radius_metres=300)
    dest = Precinct(id=uuid.uuid4(), name="FedEx DBN Hub", principal_organization_id=client_a.id,
                    latitude=DBN[0], longitude=DBN[1], geofence_radius_metres=300)
    pmb = Precinct(id=uuid.uuid4(), name="Courier Guy PMB", address="1 Church St, Pietermaritzburg",
                   principal_organization_id=client_b.id, latitude=PMB[0], longitude=PMB[1])
    db.add_all([driver, horse, trailer, origin, dest, pmb])
    await db.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-AUD-{suffix}", order_number=f"ORD-{suffix}",
        operator_organization_id=operator.id, client_organization_id=client_a.id, driver_id=driver.id,
        horse_id=horse.id, origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CLOSED, idvs_check_status=IdvsStatus.VERIFIED, idvs_checked_at=t0,
        created_by_user_id=dispatcher.id, created_at=t0, closed_at=t0 + timedelta(hours=9), trip_type="loaded",
        planned_departure_at=t0 + timedelta(hours=2), planned_arrival_at=t0 + timedelta(hours=8, minutes=30),
        actual_departure_at=t0 + timedelta(hours=2), actual_arrival_at=t0 + timedelta(hours=8, minutes=30),
    )
    db.add(trip)
    await db.flush()
    db.add(TripTrailer(trip_id=trip.id, trailer_id=trailer.id, pulsit_device_id_snapshot=trailer.pulsit_device_id))
    stop_jhb = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=1)
    stop_dbn = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=2)
    stop_pmb = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=pmb.id, sequence=3)
    db.add_all([stop_jhb, stop_dbn, stop_pmb])
    await db.flush()

    consignment_a = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WAY-A-{suffix}",
        client_organization_id=client_a.id, declared_value=Decimal("125000.00"), parcel_count_expected=2,
        pickup_stop_id=stop_jhb.id, delivery_stop_id=stop_dbn.id,
    )
    consignment_b = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=f"WAY-B-{suffix}",
        client_organization_id=client_b.id, parcel_count_expected=1, pickup_stop_id=stop_jhb.id,
        delivery_stop_id=stop_pmb.id,
    )
    db.add_all([consignment_a, consignment_b])
    await db.flush()
    db.add_all([
        Parcel(id=uuid.uuid4(), consignment_id=consignment_a.id, barcode=f"A{suffix}01", status=ParcelStatus.SCANNED_IN),
        Parcel(id=uuid.uuid4(), consignment_id=consignment_a.id, barcode=f"A{suffix}02", status=ParcelStatus.SCANNED_IN),
        Parcel(id=uuid.uuid4(), consignment_id=consignment_b.id, barcode=f"B{suffix}01", status=ParcelStatus.EXCEPTION),
    ])

    print("Uploading evidence photos to Supabase Storage…")
    seal = await _artifact(db, trip.id, f"SEAL SEAL-{suffix}", (27, 94, 32), t0 + timedelta(hours=2))
    waybill = await _artifact(db, trip.id, "WAYBILL", (13, 71, 161), t0 + timedelta(hours=2))
    pod = await _artifact(db, trip.id, "PROOF OF DELIVERY", (106, 27, 154), t0 + timedelta(hours=9))
    signature = await _artifact(db, trip.id, "RECEIVER SIGNATURE", (66, 66, 66), t0 + timedelta(hours=9))
    selfie = await _artifact(db, trip.id, "CHECKPOINT SELFIE", (128, 86, 0), t0 + timedelta(hours=4))

    def phase(seq: int, phase_type: PhaseType, stop: TripStop | None, hours: float, **kw: Any) -> PhaseEvent:
        return PhaseEvent(id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id if stop else None,
                          phase_type=phase_type, sequence_number=seq, status=PhaseStatus.COMPLETED,
                          completed_at=t0 + timedelta(hours=hours), **kw)

    creation = phase(0, PhaseType.TRIP_CREATION, None, 0)
    departure = phase(3, PhaseType.DEPARTURE, stop_jhb, 2, seal_number=f"SEAL-{suffix}",
                      seal_photo_artifact_id=seal.id, waybill_photo_artifact_id=waybill.id,
                      driver_phone_lat=JHB[0], driver_phone_lng=JHB[1], horse_gps_lat=JHB[0], horse_gps_lng=JHB[1],
                      driver_captured_at=t0 + timedelta(hours=2))
    confirmation = phase(6, PhaseType.CONFIRMATION, stop_dbn, 9, parcel_count_destination=3, driver_visual_count=3,
                         pod_photo_artifact_id=pod.id, pod_signature_artifact_id=signature.id,
                         driver_phone_lat=DBN[0], driver_phone_lng=DBN[1], driver_captured_at=t0 + timedelta(hours=9))
    db.add_all([
        creation,
        phase(1, PhaseType.ACTIVATION, stop_jhb, 1, driver_phone_lat=JHB[0], driver_phone_lng=JHB[1],
              horse_gps_lat=JHB[0], horse_gps_lng=JHB[1], driver_captured_at=t0 + timedelta(hours=1)),
        phase(2, PhaseType.LOADING, stop_jhb, 1.5, parcel_count_origin=3),
        departure,
        phase(4, PhaseType.IN_TRANSIT, stop_jhb, 7),
        phase(5, PhaseType.UNLOADING, stop_dbn, 8.5, seal_number=f"SEAL-{suffix}"),
        confirmation,
    ])
    await db.flush()

    print("Anchoring P0, P3 and P6 on Hedera testnet (a few seconds each)…")
    lock = await anchor_subject(
        db, subject_type=SubjectType.TRIP, subject_id=trip.id, receipt_type=BlockchainReceiptType.JOURNEY_LOCK,
        trip_id=trip.id, canonical_payload=compute_trip_canonical_payload(
            trip_id=trip.id, order_number=trip.order_number, driver_id=driver.id, horse_id=horse.id,
            trailer_ids=[trailer.id], origin_precinct_id=origin.id, destination_precinct_id=dest.id,
            created_by_user_id=dispatcher.id, created_at=t0, trip_type="loaded",
        ),
    )
    creation.blockchain_receipt_id, creation.anchor_status = lock.id, AnchorStatus.ANCHORED
    for event, receipt_type, payload in (
        (departure, BlockchainReceiptType.PICKUP, compute_departure_canonical_payload_v2(
            phase_event_id=departure.id, trip_id=trip.id, seal_number=f"SEAL-{suffix}",
            seal_photo_sha256=seal.file_hash, waybill_photo_sha256=waybill.file_hash)),
        (confirmation, BlockchainReceiptType.DELIVERY, compute_confirmation_canonical_payload_v2(
            phase_event_id=confirmation.id, trip_id=trip.id, pp_scan_in_count=3, driver_visual_count=3,
            pod_photo_sha256=pod.file_hash, pod_signature_sha256=signature.file_hash)),
    ):
        receipt = await anchor_subject(db, subject_type=SubjectType.PHASE_EVENT, subject_id=event.id,
                                       receipt_type=receipt_type, trip_id=trip.id, canonical_payload=payload)
        event.blockchain_receipt_id, event.anchor_status = receipt.id, AnchorStatus.ANCHORED

    # The trail: JHB → Harrismith → DBN, with one silence after Harrismith.
    times = [t0 + timedelta(hours=1) + PING_INTERVAL * i for i in range(10)]
    after_gap = times[-1] + GAP
    times += [after_gap + PING_INTERVAL * i for i in range(12)]
    route = [JHB, HARRISMITH, DBN]
    for i, at in enumerate(times):
        progress = i / (len(times) - 1)
        leg = min(int(progress * 2), 1)
        t = Decimal(str(progress * 2 - leg))
        start, end = route[leg], route[leg + 1]
        db.add(TripLocationPing(
            id=uuid.uuid4(), trip_id=trip.id, driver_id=driver.id, context="in-transit", recorded_at=at,
            lat=(start[0] + (end[0] - start[0]) * t).quantize(Decimal("0.0000001")),
            lng=(start[1] + (end[1] - start[1]) * t).quantize(Decimal("0.0000001")),
            accuracy_m=Decimal("12.5"),
        ))

    db.add(Checkpoint(id=uuid.uuid4(), trip_id=trip.id, checkpoint_type="rest_stop", created_at=t0 + timedelta(hours=4),
                      driver_phone_lat=HARRISMITH[0], driver_phone_lng=HARRISMITH[1],
                      driver_captured_at=t0 + timedelta(hours=4), selfie_artifact_id=selfie.id))
    db.add_all([
        TripException(
            id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.PANIC_BUTTON, source=ExceptionSource.DRIVER,
            severity=ExceptionSeverity.CRITICAL, description="Panic button held near Harrismith",
            gps_lat=HARRISMITH[0], gps_lng=HARRISMITH[1], created_at=t0 + timedelta(hours=5),
            review_status=ExceptionReviewStatus.REVIEWED, review_outcome="handled_externally",
            reviewed_by_user_id=dispatcher.id, reviewed_at=t0 + timedelta(hours=5, minutes=6), contact_method="phone",
            review_note="Driver safe; false alarm at a fuel stop",
        ),
        TripException(
            id=uuid.uuid4(), trip_id=trip.id, exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
            source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.WARNING, consignment_id=consignment_b.id,
            description=f"WAY-B-{suffix} short one parcel", created_at=t0 + timedelta(hours=8),
        ),
    ])
    await db.flush()
    return trip


async def main() -> None:
    if not any(host in settings.DATABASE_URL for host in _LOCAL_HOSTS):
        sys.exit("Refusing to run: DATABASE_URL is not a localhost database. This script seeds a LOCAL "
                 "database only — see the usage line in its docstring.")
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        trip = await seed(db)
        await db.commit()
    await engine.dispose()
    print(f"\nSeeded trip {trip.trip_reference}  (id {trip.id})")
    print(f"  Dispatcher tab: http://localhost:3000/trips/{trip.id}?panel=audit")
    print("  API docs:       http://localhost:8000/docs")


if __name__ == "__main__":
    asyncio.run(main())
