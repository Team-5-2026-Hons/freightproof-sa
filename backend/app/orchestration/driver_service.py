"""Service functions for driver resources.

Extracted from resource_service.py — owns list/create/update/detail for Driver.
Layering: imports db/, schemas/, core/exceptions, integrations/ only.
"""

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.blockchain.critical_fields import diff_critical_fields
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.integrations.supabase_admin import create_driver_auth_user
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, DriverEventType, IdvsStatus, SubjectType,
)
from app.db.models.events import DriverEvent
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import DriverEventRead
from app.schemas.people import DriverCreateBody, DriverDetailResponse, DriverRead, DriverUpdateBody

# POPIA: these fields must never appear in JSONB event audit logs.
_DRIVER_PII_FIELDS: frozenset[str] = frozenset({"license_number", "phone_number"})

# Uses sha256-keyed names because update_driver diffs hashed values, not plaintext.
_DRIVER_CRITICAL_HASHED: frozenset[str] = frozenset({
    "license_number_sha256",
    "license_expiry",
    "is_active",
})


async def list_drivers(
    db: AsyncSession,
    organization_id: uuid.UUID,
) -> list[DriverRead]:
    result = await db.execute(
        select(Driver)
        .where(Driver.organization_id == organization_id, Driver.is_active.is_(True))
        .order_by(Driver.full_name)
    )
    return [DriverRead.model_validate(d) for d in result.scalars().all()]


async def create_driver(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: DriverCreateBody,
    current_user_id: uuid.UUID,
) -> DriverRead:
    # Provision a Supabase Auth account first — drivers.id must reference
    # auth.users(id) per the FK constraint added in migration 0003.
    driver_id = await create_driver_auth_user(
        phone=data.phone_number,
        full_name=data.full_name,
    )
    driver = Driver(
        id=driver_id,
        organization_id=organization_id,
        full_name=data.full_name,
        id_number=data.id_number,
        phone_number=data.phone_number,
        license_number=data.license_number,
        license_expiry=data.license_expiry,
        idvs_status=IdvsStatus.PENDING,
    )
    db.add(driver)
    try:
        await db.flush()
    except IntegrityError as exc:
        orig = getattr(exc, "orig", None)
        pgcode = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
        if pgcode != "23505":
            raise
        raise DuplicateResourceError("Driver", "id_number", data.id_number) from exc

    # POPIA: license_number is hashed before going on chain. Plaintext stays in DB only.
    license_number_sha256 = hashlib.sha256(
        driver.license_number.encode("utf-8")
    ).hexdigest()

    snapshot = {
        "license_number_sha256": license_number_sha256,
        "license_expiry": driver.license_expiry.isoformat() if driver.license_expiry else None,
        "is_active": driver.is_active,
    }
    driver_event = DriverEvent(
        id=uuid.uuid4(),
        driver_id=driver.id,
        event_type=DriverEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
    )
    db.add(driver_event)
    await db.flush()

    canonical = {
        "driver_event_id": str(driver_event.id),
        "driver_id": str(driver.id),
        "event_type": DriverEventType.CREATED.value,
        "fields": snapshot,
        "changed_by_user_id": str(current_user_id),
        "timestamp": driver_event.created_at.isoformat(),
    }
    receipt = await anchor_subject(
        db,
        subject_type=SubjectType.DRIVER_EVENT,
        subject_id=driver_event.id,
        canonical_payload=canonical,
        receipt_type=BlockchainReceiptType.DRIVER_CREATED,
    )
    driver_event.blockchain_receipt_id = receipt.id

    await db.refresh(driver)
    return DriverRead.model_validate(driver)


async def update_driver(
    db: AsyncSession,
    driver_id: uuid.UUID,
    organization_id: uuid.UUID,
    data: DriverUpdateBody,
    current_user_id: uuid.UUID,
) -> DriverRead:
    driver = (
        await db.execute(
            select(Driver).where(
                Driver.id == driver_id, Driver.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", str(driver_id))

    # POPIA: compare hashed license numbers so plaintext never enters the diff.
    # _DRIVER_CRITICAL_HASHED uses sha256-keyed names — see module-level constant.
    old = {
        "license_number_sha256": hashlib.sha256(
            driver.license_number.encode("utf-8")
        ).hexdigest(),
        "license_expiry": driver.license_expiry.isoformat() if driver.license_expiry else None,
        "is_active": driver.is_active,
    }

    patched = data.model_dump(exclude_unset=True)
    for field, value in patched.items():
        setattr(driver, field, value)
    await db.flush()

    new = {
        "license_number_sha256": hashlib.sha256(
            driver.license_number.encode("utf-8")
        ).hexdigest(),
        "license_expiry": driver.license_expiry.isoformat() if driver.license_expiry else None,
        "is_active": driver.is_active,
    }

    diff = diff_critical_fields(old, new, _DRIVER_CRITICAL_HASHED)
    event_type = DriverEventType.COSMETIC_UPDATE
    if diff is not None:
        if "license_number_sha256" in diff:
            event_type = DriverEventType.LICENSE_RENEWED
        elif "is_active" in diff and not new["is_active"]:
            event_type = DriverEventType.DEACTIVATED

    # Exclude license_number plaintext from the cosmetic patch record stored in DB.
    safe_patch = {k: v for k, v in patched.items() if k not in _DRIVER_PII_FIELDS}
    event = DriverEvent(
        id=uuid.uuid4(),
        driver_id=driver.id,
        event_type=event_type.value,
        changed_fields=diff or {"_no_critical_change": True, "_patch": safe_patch},
        changed_by_user_id=current_user_id,
    )
    db.add(event)
    await db.flush()

    if diff is not None:
        canonical = {
            "driver_event_id": str(event.id),
            "driver_id": str(driver.id),
            "event_type": event_type.value,
            "fields": diff,
            "changed_by_user_id": str(current_user_id),
            "timestamp": event.created_at.isoformat(),
        }
        receipt = await anchor_subject(
            db,
            subject_type=SubjectType.DRIVER_EVENT,
            subject_id=event.id,
            canonical_payload=canonical,
            receipt_type=BlockchainReceiptType.DRIVER_UPDATED,
        )
        event.blockchain_receipt_id = receipt.id

    await db.refresh(driver)
    return DriverRead.model_validate(driver)


async def get_driver_detail(
    db: AsyncSession,
    driver_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> DriverDetailResponse:
    driver = (
        await db.execute(
            select(Driver).where(
                Driver.id == driver_id, Driver.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if driver is None:
        raise ResourceNotFoundError("Driver", str(driver_id))

    events = (
        await db.execute(
            select(DriverEvent)
            .where(DriverEvent.driver_id == driver_id)
            .order_by(DriverEvent.created_at.desc())
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    if event_ids:
        receipts = (
            await db.execute(
                select(BlockchainReceipt).where(
                    (BlockchainReceipt.subject_type == SubjectType.DRIVER_EVENT)
                    & (BlockchainReceipt.subject_id.in_(event_ids))
                ).order_by(BlockchainReceipt.created_at.desc())
            )
        ).scalars().all()
    else:
        receipts = []

    # Include org filter so trips from other organisations never appear in this driver's detail.
    trips = (
        await db.execute(
            select(Trip).where(
                Trip.driver_id == driver_id,
                Trip.operator_organization_id == organization_id,
            ).order_by(Trip.created_at.desc())
        )
    ).scalars().all()

    return DriverDetailResponse(
        **DriverRead.model_validate(driver).model_dump(),
        events=[DriverEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        trip_ids=[t.id for t in trips],
    )
