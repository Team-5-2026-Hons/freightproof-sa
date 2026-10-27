"""Service functions for driver resources.

Extracted from resource_service.py — owns list/create/update/detail for Driver.
Layering: imports db/, schemas/, core/exceptions, integrations/ only.
"""

import hashlib
import uuid
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.blockchain.critical_fields import diff_critical_fields
from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.orchestration.fleet.canonical import anchor_fleet_event
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.integrations.supabase_admin import create_driver_auth_user
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, DriverEventType, IdvsStatus, SubjectType,
)
from app.db.models.events import DriverEvent
from app.db.models.people import UQ_DRIVERS_ORG_ID_NUMBER, Driver
from app.db.models.trips import DriverSubstitution, Trip
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import DriverEventRead
from app.schemas.people import DriverCreateBody, DriverDetailResponse, DriverRead, DriverUpdateBody

_DRIVER_PII_FIELDS: frozenset[str] = frozenset({"license_number", "phone_number"})

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
    existing = await db.execute(
        select(Driver.id).where(
            Driver.organization_id == organization_id,
            Driver.id_number == data.id_number,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise DuplicateResourceError("Driver", "id_number", data.id_number)

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
        if not is_unique_violation(exc):
            raise
        if violated_constraint(exc) != UQ_DRIVERS_ORG_ID_NUMBER:
            raise
        raise DuplicateResourceError("Driver", "id_number", data.id_number) from exc

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

    await anchor_fleet_event(
        db,
        anchor=anchor_subject,
        event=driver_event,
        receipt_type=BlockchainReceiptType.DRIVER_CREATED,
    )

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

    safe_patch = {k: v for k, v in patched.items() if k not in _DRIVER_PII_FIELDS}
    _fallback: dict[str, Any] = {"_no_critical_change": True, "_patch": safe_patch}
    changed_fields: dict[str, Any] = diff or _fallback
    event = DriverEvent(
        id=uuid.uuid4(),
        driver_id=driver.id,
        event_type=event_type.value,
        changed_fields=changed_fields,
        changed_by_user_id=current_user_id,
    )
    db.add(event)
    await db.flush()

    if diff is not None:
        await anchor_fleet_event(
            db,
            anchor=anchor_subject,
            event=event,
            receipt_type=BlockchainReceiptType.DRIVER_UPDATED,
        )

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

    trips = (
        await db.execute(
            select(Trip).where(
                or_(Trip.driver_id == driver_id, Trip.id.in_(select(DriverSubstitution.trip_id).where(or_(
                    DriverSubstitution.original_driver_id == driver_id,
                    DriverSubstitution.substituting_driver_id == driver_id,
                )))),
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
