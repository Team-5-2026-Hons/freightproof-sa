"""Service functions for vehicle resources.

Extracted from resource_service.py — owns list/create/update/detail for Vehicle.
"""

import hashlib
import uuid
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.blockchain.critical_fields import VEHICLE_CRITICAL_FIELDS, diff_critical_fields
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, SubjectType, VehicleEventType,
)
from app.db.models.events import VehicleEvent
from app.db.models.trips import Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import VehicleEventRead
from app.schemas.vehicles import VehicleCreateBody, VehicleDetailResponse, VehicleRead, VehicleUpdateBody


async def list_vehicles(
    db: AsyncSession,
    organization_id: uuid.UUID,
) -> list[VehicleRead]:
    result = await db.execute(
        select(Vehicle)
        .where(Vehicle.organization_id == organization_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.registration)
    )
    return [VehicleRead.model_validate(v) for v in result.scalars().all()]


async def create_vehicle(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: VehicleCreateBody,
    current_user_id: uuid.UUID,
) -> VehicleRead:
    vehicle = Vehicle(
        organization_id=organization_id,
        registration=data.registration,
        vehicle_type=data.vehicle_type,
        pulsit_device_id=data.pulsit_device_id,
        make=data.make,
        model=data.model,
        year=data.year,
        vin_number=data.vin_number,
        licence_disc_expiry=data.licence_disc_expiry,
        gross_vehicle_mass_kg=data.gross_vehicle_mass_kg,
    )
    db.add(vehicle)
    try:
        await db.flush()
    except IntegrityError as exc:
        orig = getattr(exc, "orig", None)
        pgcode = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
        if pgcode != "23505":
            raise
        raise DuplicateResourceError("Vehicle", "registration", data.registration) from exc

    snapshot = {
        "registration": vehicle.registration,
        "vehicle_type": vehicle.vehicle_type.value,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "make": vehicle.make,
        "model": vehicle.model,
        "year": vehicle.year,
        "vin_number": vehicle.vin_number,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "is_active": vehicle.is_active,
    }
    vehicle_event = VehicleEvent(
        id=uuid.uuid4(),
        vehicle_id=vehicle.id,
        event_type=VehicleEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(vehicle_event)
    await db.flush()

    # Build payload-safe fields: hash the GPS device ID.
    # snapshot in vehicle_event.changed_fields keeps plaintext (Supabase DB, POPIA-compliant).
    # canonical (→ payload_json in BlockchainReceipt) uses the hash only.
    _canonical_fields = {
        **snapshot,
        "pulsit_device_id_sha256": hashlib.sha256(
            str(snapshot.get("pulsit_device_id") or "").encode("utf-8")
        ).hexdigest() if snapshot.get("pulsit_device_id") else None,
    }
    _canonical_fields.pop("pulsit_device_id", None)

    canonical = {
        "vehicle_event_id": str(vehicle_event.id),
        "vehicle_id": str(vehicle.id),
        "event_type": VehicleEventType.CREATED.value,
        "fields": _canonical_fields,    # ← was `snapshot`; device ID hashed for POPIA compliance
        "changed_by_user_id": str(current_user_id),
        "timestamp": vehicle_event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.VEHICLE_EVENT,
        subject_id=vehicle_event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.VEHICLE_CREATED,
    )
    vehicle_event.blockchain_receipt_id = receipt.id

    await db.refresh(vehicle)
    return VehicleRead.model_validate(vehicle)


async def update_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    organization_id: uuid.UUID,
    data: VehicleUpdateBody,
    current_user_id: uuid.UUID,
) -> VehicleRead:
    vehicle = (
        await db.execute(
            select(Vehicle).where(
                Vehicle.id == vehicle_id, Vehicle.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError("Vehicle", str(vehicle_id))

    old = {
        "registration": vehicle.registration,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "vehicle_type": vehicle.vehicle_type.value,
        "vin_number": vehicle.vin_number,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "is_active": vehicle.is_active,
    }
    patched = data.model_dump(exclude_unset=True)
    for field, value in patched.items():
        setattr(vehicle, field, value)
    await db.flush()
    new = {
        "registration": vehicle.registration,
        "licence_disc_expiry": vehicle.licence_disc_expiry.isoformat() if vehicle.licence_disc_expiry else None,
        "vehicle_type": vehicle.vehicle_type.value,
        "vin_number": vehicle.vin_number,
        "pulsit_device_id": vehicle.pulsit_device_id,
        "is_active": vehicle.is_active,
    }

    diff = diff_critical_fields(old, new, VEHICLE_CRITICAL_FIELDS)
    event_type = VehicleEventType.COSMETIC_UPDATE
    if diff is not None:
        changed = set(diff.keys())
        if "registration" in changed:
            event_type = VehicleEventType.LICENSE_PLATE_CHANGED
        elif "is_active" in changed and not new["is_active"]:
            event_type = VehicleEventType.DEACTIVATED
        elif changed == {"licence_disc_expiry"}:
            # Only the disc expiry changed — specific label
            event_type = VehicleEventType.LICENSE_DISC_RENEWED
        elif changed == {"vin_number"}:
            # Only the VIN changed — specific label
            event_type = VehicleEventType.VIN_UPDATED
        else:
            # Multiple critical fields changed simultaneously
            event_type = VehicleEventType.VEHICLE_UPDATED

    # diff is dict[str, dict[...]]; the no-change fallback mixes bool/dict values. Give the
    # fallback its own dict[str, Any] type so `or` doesn't infer it from diff's stricter type.
    _fallback: dict[str, Any] = {"_no_critical_change": True, "_patch": patched}
    changed_fields: dict[str, Any] = diff or _fallback
    event = VehicleEvent(
        id=uuid.uuid4(),
        vehicle_id=vehicle.id,
        event_type=event_type.value,
        changed_fields=changed_fields,
        changed_by_user_id=current_user_id,
    )
    db.add(event)
    await db.flush()

    if diff is not None:
        _canonical_diff = dict(diff)
        if "pulsit_device_id" in _canonical_diff:
            entry = _canonical_diff.pop("pulsit_device_id")
            # entry is {"from": "...", "to": "..."} — hash both sides for POPIA compliance
            _canonical_diff["pulsit_device_id_sha256"] = {
                k: hashlib.sha256((v or "").encode()).hexdigest()
                for k, v in entry.items()
            }

        canonical = {
            "vehicle_event_id": str(event.id),
            "vehicle_id": str(vehicle.id),
            "event_type": event_type.value,
            "fields": _canonical_diff,    # ← was `diff`; device ID hashed for POPIA compliance
            "changed_by_user_id": str(current_user_id),
            "timestamp": event.created_at.isoformat(),
        }
        receipt = await anchor_subject(
            db,
            subject_type=SubjectType.VEHICLE_EVENT,
            subject_id=event.id,
            canonical_payload=canonical,
            receipt_type=BlockchainReceiptType.VEHICLE_UPDATED,
        )
        event.blockchain_receipt_id = receipt.id

    await db.refresh(vehicle)
    return VehicleRead.model_validate(vehicle)


async def get_vehicle_detail(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> VehicleDetailResponse:
    vehicle = (
        await db.execute(
            select(Vehicle).where(
                Vehicle.id == vehicle_id, Vehicle.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise ResourceNotFoundError("Vehicle", str(vehicle_id))

    events = (
        await db.execute(
            select(VehicleEvent)
            .where(VehicleEvent.vehicle_id == vehicle_id)
            .order_by(VehicleEvent.created_at.desc())
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    if event_ids:
        receipts = (
            await db.execute(
                select(BlockchainReceipt).where(
                    or_(
                        (BlockchainReceipt.subject_type == SubjectType.VEHICLE)
                        & (BlockchainReceipt.subject_id == vehicle_id),
                        (BlockchainReceipt.subject_type == SubjectType.VEHICLE_EVENT)
                        & (BlockchainReceipt.subject_id.in_(event_ids)),
                    )
                ).order_by(BlockchainReceipt.created_at.desc())
            )
        ).scalars().all()
    else:
        receipts = []

    # Include org filter so trips from other organisations never appear in this vehicle's detail.
    trips = (
        await db.execute(
            select(Trip).where(
                Trip.operator_organization_id == organization_id,
                or_(
                    Trip.horse_id == vehicle_id,
                    Trip.id.in_(
                        select(TripTrailer.trip_id).where(TripTrailer.trailer_id == vehicle_id)
                    ),
                ),
            ).order_by(Trip.created_at.desc())
        )
    ).scalars().all()

    return VehicleDetailResponse(
        **VehicleRead.model_validate(vehicle).model_dump(),
        events=[VehicleEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        trip_ids=[t.id for t in trips],
    )
