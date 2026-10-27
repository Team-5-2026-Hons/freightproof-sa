"""Service functions for precinct resources.

Extracted from resource_service.py on the same grounds as fleet/drivers.py and
fleet/vehicles.py before it — owns list/create/update/detail for Precinct.

Layering: imports db/, schemas/, blockchain/, core/exceptions only. Never api/ or auth/.

Org scoping is the whole job of this module and is deliberately asymmetric:

  READ  — own org OR is_shared. A dispatcher can see a depot they do not own, which
          is what lets an operator plan trips into a client's facility.
  WRITE — own org only. Ownership comes from the authenticated caller and is never
          read from the request body, so there is no way to create a precinct under
          another org's id or edit one you do not own (SEC-PRECINCT-1).

A write against a precinct owned by another org raises ResourceNotFoundError, which the
endpoint maps to 404 rather than 403 — the same choice get_trip_detail and update_vehicle
already make, so a caller cannot probe for the existence of another org's rows.

Anchoring mirrors fleet.vehicles: every write appends a PrecinctEvent, and changes to
PRECINCT_CRITICAL_FIELDS additionally anchor to Hedera.
"""

import uuid
from typing import Any
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject
from app.blockchain.critical_fields import (
    PRECINCT_COSMETIC_FIELDS, PRECINCT_CRITICAL_FIELDS, diff_critical_fields,
)
from app.core.exceptions import DuplicateResourceError, InvalidGeofenceError, ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import BlockchainReceiptType, PrecinctEventType, SubjectType
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Precinct
from app.orchestration.fleet.canonical import anchor_fleet_event
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.events import PrecinctEventRead
from app.schemas.organisations import (
    PrecinctCreateBody, PrecinctDetailResponse, PrecinctRead, PrecinctUpdateBody,
    check_pin_fits_polygon,
)


def _geofence_snapshot(precinct: Precinct) -> dict[str, Any]:
    """The precinct's state as plain JSON-safe values.

    latitude/longitude are Numeric columns, so a loaded row holds Decimal — which is
    not JSON-serialisable and would break the anchor payload. float() is safe here for
    the same reason PrecinctRead declares float: a GPS coordinate is at most 10
    significant digits and float64 carries ~15.65.
    """
    snapshot: dict[str, Any] = {
        "name": precinct.name,
        "address": precinct.address,
        "latitude": float(precinct.latitude),
        "longitude": float(precinct.longitude),
        "geofence_radius_metres": precinct.geofence_radius_metres,
        "is_shared": precinct.is_shared,
    }
    if precinct.geofence_polygon is not None:
        snapshot["geofence_polygon"] = precinct.geofence_polygon
    return snapshot


async def _assert_name_free(
    db: AsyncSession,
    organization_id: uuid.UUID,
    name: str,
    exclude_precinct_id: uuid.UUID | None = None,
) -> None:
    """Raise DuplicateResourceError if organization_id already has a precinct called `name`.

    ADVISORY ONLY — there is no unique constraint on precincts.name, so this is a check,
    not a guarantee: two concurrent creates can both pass it. It is here because the
    failure it prevents is a demo-day failure rather than a data-integrity one — two rows
    called "FedEx DBN" at different coordinates, with the dispatcher unable to tell which
    one trip creation just picked. Scoped per-org because two companies may legitimately
    both operate a depot of the same name.

    Making this real needs a UniqueConstraint(principal_organization_id, name) and a
    migration — tracked as follow-up.
    """
    query = select(Precinct.id).where(
        Precinct.principal_organization_id == organization_id,
        Precinct.name == name,
    )
    if exclude_precinct_id is not None:
        query = query.where(Precinct.id != exclude_precinct_id)

    if (await db.execute(query)).first() is not None:
        raise DuplicateResourceError("Precinct", "name", name)


async def list_precincts(db: AsyncSession, organization_id: uuid.UUID) -> list[PrecinctRead]:
    """Return precincts owned by organization_id, plus any precinct marked is_shared.

    Precincts default to private to their principal_organization_id — a precinct is only
    visible to other orgs' dispatchers if explicitly opted in via is_shared.
    """
    result = await db.execute(
        select(Precinct)
        .where(
            (Precinct.principal_organization_id == organization_id)
            | (Precinct.is_shared.is_(True))
        )
        .order_by(Precinct.name)
    )
    return [PrecinctRead.model_validate(p) for p in result.scalars().all()]


async def create_precinct(
    db: AsyncSession,
    organization_id: uuid.UUID,
    data: PrecinctCreateBody,
    current_user_id: uuid.UUID,
) -> PrecinctRead:
    """Create a precinct owned by organization_id, log it, and anchor the log entry.

    organization_id is the AUTHENTICATED caller's org, passed by the endpoint from the
    JWT-resolved user. PrecinctCreateBody has no such field, so no request body can
    influence ownership.
    """
    await _assert_name_free(db, organization_id=organization_id, name=data.name)

    precinct = Precinct(
        name=data.name,
        address=data.address,
        principal_organization_id=organization_id,
        latitude=data.latitude,
        longitude=data.longitude,
        geofence_radius_metres=data.geofence_radius_metres,
        geofence_polygon=data.geofence_polygon,
        is_shared=data.is_shared,
    )
    db.add(precinct)
    await db.flush()

    snapshot = _geofence_snapshot(precinct)
    event_timestamp = datetime.now(UTC)
    event = PrecinctEvent(
        id=uuid.uuid4(),
        precinct_id=precinct.id,
        event_type=PrecinctEventType.CREATED.value,
        changed_fields=snapshot,
        changed_by_user_id=current_user_id,
        created_at=event_timestamp,
    )
    db.add(event)
    await db.flush()

    await anchor_fleet_event(
        db,
        anchor=anchor_subject,
        event=event,
        receipt_type=BlockchainReceiptType.PRECINCT_CREATED,
    )

    await db.refresh(precinct)
    return PrecinctRead.model_validate(precinct)


def _classify(changed: set[str]) -> PrecinctEventType:
    """Label a critical diff with the single fact that matters most about it.

    Priority is deliberate and total, so no combination falls through unlabelled. A move
    outranks a resize because relocating a facility invalidates more history than
    widening it. Nothing is lost to the label — changed_fields always carries the full
    diff, so the event_type is a heading and the diff is the record.
    """
    if {"latitude", "longitude"} & changed:
        return PrecinctEventType.RELOCATED
    if "geofence_polygon" in changed:
        return PrecinctEventType.GEOFENCE_RESHAPED
    if "geofence_radius_metres" in changed:
        return PrecinctEventType.GEOFENCE_RESIZED
    if "is_shared" in changed:
        return PrecinctEventType.SHARING_CHANGED
    return PrecinctEventType.COSMETIC_UPDATE


async def _get_owned_precinct(
    db: AsyncSession, *, precinct_id: uuid.UUID, organization_id: uuid.UUID,
) -> Precinct:
    """The org filter is in the WHERE clause, so another org's precinct — shared or not —
    is indistinguishable from one that does not exist."""
    result = await db.execute(
        select(Precinct).where(
            Precinct.id == precinct_id,
            Precinct.principal_organization_id == organization_id,
        )
    )
    precinct = result.scalar_one_or_none()
    if precinct is None:
        raise ResourceNotFoundError("Precinct", str(precinct_id))
    return precinct


async def _validate_precinct_patch(
    db: AsyncSession, *, precinct: Precinct, organization_id: uuid.UUID, data: PrecinctUpdateBody,
) -> dict[str, Any]:
    """The fields a PATCH sets, after the name-uniqueness and pin-in-outline checks."""
    patched = data.model_dump(exclude_unset=True)
    if "name" in patched:
        await _assert_name_free(
            db,
            organization_id=organization_id,
            name=patched["name"],
            exclude_precinct_id=precinct.id,
        )

    merged_polygon = patched.get("geofence_polygon", precinct.geofence_polygon)
    if merged_polygon is not None:
        try:
            check_pin_fits_polygon(
                patched.get("latitude", precinct.latitude),
                patched.get("longitude", precinct.longitude),
                merged_polygon,
            )
        except ValueError as exc:
            raise InvalidGeofenceError(str(exc)) from exc
    return patched


async def update_precinct(
    db: AsyncSession,
    precinct_id: uuid.UUID,
    organization_id: uuid.UUID,
    data: PrecinctUpdateBody,
    current_user_id: uuid.UUID,
) -> PrecinctRead:
    """Apply a partial update to a precinct owned by organization_id.

    The org filter is in the WHERE clause rather than checked after loading, so a
    precinct belonging to another org is indistinguishable from one that does not exist
    — including a shared one the caller can see in GET /precincts. Visibility is not
    permission.
    """
    precinct = await _get_owned_precinct(db, precinct_id=precinct_id, organization_id=organization_id)
    patched = await _validate_precinct_patch(
        db, precinct=precinct, organization_id=organization_id, data=data,
    )

    old = _geofence_snapshot(precinct)
    for field, value in patched.items():
        setattr(precinct, field, value)
    await db.flush()
    new = _geofence_snapshot(precinct)

    critical_diff = diff_critical_fields(old, new, PRECINCT_CRITICAL_FIELDS)
    full_diff = diff_critical_fields(
        old, new, PRECINCT_CRITICAL_FIELDS | PRECINCT_COSMETIC_FIELDS
    )

    if full_diff is None:
        await db.refresh(precinct)
        return PrecinctRead.model_validate(precinct)

    event_type = (
        _classify(set(critical_diff.keys()))
        if critical_diff is not None
        else PrecinctEventType.COSMETIC_UPDATE
    )
    event_timestamp = datetime.now(UTC)
    event = PrecinctEvent(
        id=uuid.uuid4(),
        precinct_id=precinct.id,
        event_type=event_type.value,
        changed_fields=full_diff,
        changed_by_user_id=current_user_id,
        created_at=event_timestamp,
    )
    db.add(event)
    await db.flush()

    if critical_diff is not None:
        await anchor_fleet_event(
            db,
            anchor=anchor_subject,
            event=event,
            receipt_type=BlockchainReceiptType.PRECINCT_UPDATED,
        )

    await db.refresh(precinct)
    return PrecinctRead.model_validate(precinct)


async def get_precinct_detail(
    db: AsyncSession,
    precinct_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> PrecinctDetailResponse:
    """Return a precinct the caller may SEE, with its change history if they own it.

    Read scoping, not write scoping: own-org OR is_shared, matching list_precincts. A
    dispatcher planning a trip into a client's shared depot can open it and see where
    its geofence sits — they simply cannot edit it, and cannot verify its receipts
    (see subject_visibility, which scopes the audit trail to the owner alone).

    The change history is scoped to the OWNER, not to who can see the precinct. is_shared
    publishes where a facility is now, so another org can plan a trip into it; it does not
    publish how it got there. The event rows carry every historical coordinate the depot
    has ever had and the user ids of the admins who moved it — another organisation's
    internal record, which sharing a location was never consent to hand over.

    This is the same rule subject_visibility already enforces for verification, stated
    there as "is_shared governs the precinct list; it never opens the audit trail to
    another organisation". It is applied HERE, in the service, so ownership is decided in
    exactly one place: the endpoint's remaining job is the admin-role check on receipts,
    which is a different question (who may see forensic detail) from this one (whose
    record is it).
    """
    precinct = (
        await db.execute(
            select(Precinct).where(
                Precinct.id == precinct_id,
                (
                    (Precinct.principal_organization_id == organization_id)
                    | (Precinct.is_shared.is_(True))
                ),
            )
        )
    ).scalar_one_or_none()
    if precinct is None:
        raise ResourceNotFoundError("Precinct", str(precinct_id))

    if precinct.principal_organization_id != organization_id:
        return PrecinctDetailResponse(
            **PrecinctRead.model_validate(precinct).model_dump(), events=[], receipts=[]
        )

    events = (
        await db.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.precinct_id == precinct_id)
            .order_by(PrecinctEvent.created_at.desc(), PrecinctEvent.id)
        )
    ).scalars().all()

    event_ids = [e.id for e in events]
    receipts: Sequence[BlockchainReceipt] = []
    if event_ids:
        receipts = (
            await db.execute(
                select(BlockchainReceipt)
                .where(
                    BlockchainReceipt.subject_type == SubjectType.PRECINCT_EVENT,
                    BlockchainReceipt.subject_id.in_(event_ids),
                )
                .order_by(BlockchainReceipt.created_at.desc())
            )
        ).scalars().all()

    return PrecinctDetailResponse(
        **PrecinctRead.model_validate(precinct).model_dump(),
        events=[PrecinctEventRead.model_validate(e) for e in events],
        receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
    )
