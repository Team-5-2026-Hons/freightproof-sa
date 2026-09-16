"""Consignment sync service — maps a PPWaybillResponse onto Consignment + Parcel DB rows.

Called at trip creation to pull waybill data from Parcel Perfect and persist it.
Idempotent: a second call for the same pp_reference updates the existing row
rather than inserting a duplicate. Client org attribution is derived from the
waybill's PP account number (accnum), not supplied by the caller.

Layering: orchestration → integrations, db. Never imports from api/ or auth/.
"""

import logging
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConsignmentAlreadyAssignedError
from app.db.models.enums import ParcelStatus
from app.db.models.organisations import Organization
from app.db.models.trips import Consignment, Parcel, Trip
from app.integrations.parcel_perfect import PPWaybillResponse, get_pp_client
from app.orchestration.integrity import is_unique_violation

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConsignmentSyncResult:
    """Result of a sync — the upserted row plus a non-fatal warning, if any."""

    consignment: Consignment
    warning: str | None  # e.g. unmapped PP account — surfaced, never fatal


def serialise_waybill(w: PPWaybillResponse) -> dict[str, Any]:
    """Convert a PPWaybillResponse to a JSON-safe dict for storage in pp_raw_json.

    Dataclasses are not JSON-serialisable by default, so we flatten each nested
    object into plain dicts. Stored verbatim in JSONB — no lossy type coercion.

    Public so scripts/seed_trips.py writes byte-identical pp_raw_json to what a
    real trip creation writes: a seed that stores a different shape from the live
    path is a seed that hides bugs in whatever reads that column.
    """
    return {
        "details": {
            "waybill": w.details.waybill,
            "waydate": w.details.waydate,
            "pieces": w.details.pieces,
            "duedate": w.details.duedate,
            "declared_value": w.details.declared_value,
            "dest_address": w.details.dest_address,
            "dest_town": w.details.dest_town,
            "dest_person": w.details.dest_person,
            "dest_contact": w.details.dest_contact,
            "orig_person": w.details.orig_person,
            "orig_town": w.details.orig_town,
            "orig_address": w.details.orig_address,
            "service": w.details.service,
            "actual_weight_kg": w.details.actual_weight_kg,
            "freight_total": w.details.freight_total,
            "poddate": w.details.poddate,
            "failtype": w.details.failtype,
            "client_reference": w.details.client_reference,
            "accnum": w.details.accnum,
            "custname": w.details.custname,
            "manifest": w.details.manifest,
        },
        "contents": [
            {
                "item": c.item,
                "description": c.description,
                "actmass": c.actmass,
                "pieces": c.pieces,
            }
            for c in w.contents
        ],
        "tracks": [
            {
                "trackno": t.trackno,
                "parcelno": t.parcelno,
                "item": t.item,
            }
            for t in w.tracks
        ],
        "wayrefs": [
            {"reference": r.reference, "pageno": r.pageno}
            for r in w.wayrefs
        ],
    }


async def fetch_and_sync_consignment(
    db: AsyncSession,
    pp_reference: str,
    *,
    trip_id: Optional[uuid.UUID] = None,
    unit_count_expected: Optional[int] = None,
    origin_precinct_id: Optional[uuid.UUID] = None,
    destination_precinct_id: Optional[uuid.UUID] = None,
) -> ConsignmentSyncResult:
    """Fetch a waybill from Parcel Perfect and upsert it into the DB.

    Client org attribution is derived from the waybill's PP account number
    (accnum → Organization.pp_account_number), not supplied by the caller. An
    unmapped accnum is not fatal: the consignment is still saved
    (client_organization_id=None) with a warning for the caller to surface.

    Idempotent and safe under concurrent calls: if a Consignment with the same
    pp_reference already exists, its pp_raw_json, parcel_count_expected and
    pp_manifest_number are refreshed and returned. Parcel rows are never
    deleted, only new barcodes inserted. The caller is responsible for db.commit().

    Concurrency is held by two complementary guards, since one waybill must never
    end up on two trips each anchoring its own journey-lock hash: FOR UPDATE below
    locks an existing row against reassignment, and the unique constraint on
    parcel_perfect_reference arbitrates two callers racing to insert the first row
    (which nothing can lock beforehand).

    Raises:
        ConsignmentAlreadyAssignedError: the waybill is already on another trip,
            whether visible on entry or only after losing the insert race — both
            paths raise the same error, so a dispatcher can't tell which way they lost.
        Any exception from get_pp_client().get_single_waybill() propagates unchanged.
    """
    # Fetched first so a PP error aborts before any DB interaction.
    logger.info("fetch_and_sync_consignment pp_reference=%s", pp_reference)
    waybill: PPWaybillResponse = await get_pp_client().get_single_waybill(pp_reference)

    # FOR UPDATE holds the row for the rest of this transaction, so a second caller
    # at the same waybill waits here rather than reading a trip_id about to change
    # underneath it. Without it, two callers could both read trip_id=None and both
    # write their own trip_id below, silently taking the cargo off the earlier trip.
    existing_result = await db.execute(
        select(Consignment)
        .where(Consignment.parcel_perfect_reference == pp_reference)
        .with_for_update()
    )
    consignment: Optional[Consignment] = existing_result.scalar_one_or_none()

    # Refuse to move a consignment between trips: without this, the caller's own
    # restamping of pickup/delivery stops would silently rewrite an already-
    # anchored trip's route basis. Same trip_id is not a conflict — that's the
    # Celery refresh poll re-syncing onto the trip it already has.
    if (
        consignment is not None
        and consignment.trip_id is not None
        and trip_id is not None
        and consignment.trip_id != trip_id
    ):
        owner_result = await db.execute(
            select(Trip.trip_reference).where(Trip.id == consignment.trip_id)
        )
        owner_reference = owner_result.scalar_one_or_none()
        logger.warning(
            "Rejected reassignment of consignment pp_reference=%s from trip %s to trip %s",
            pp_reference, consignment.trip_id, trip_id,
        )
        raise ConsignmentAlreadyAssignedError(pp_reference, owner_reference or str(consignment.trip_id))

    # Resolved from accnum, PP's source of truth for client attribution. Skipped
    # when already linked to a client org: re-querying on every Celery refresh is
    # wasted work, and a later org-row deletion would otherwise emit a spurious
    # warning for an already-attributed consignment.
    warning: str | None = None
    client_org_id: Optional[uuid.UUID] = None
    if consignment is None or consignment.client_organization_id is None:
        accnum = waybill.details.accnum
        if accnum:
            org_result = await db.execute(
                select(Organization.id).where(Organization.pp_account_number == accnum)
            )
            client_org_id = org_result.scalar_one_or_none()
        if client_org_id is None:
            warning = (
                f"PP account {accnum or 'unknown'!r} ({waybill.details.custname or 'no name'}) "
                f"has no matching organization — consignment {pp_reference!r} saved without a client org"
            )
            logger.warning(warning)

    raw_json: dict[str, Any] = serialise_waybill(waybill)
    parcel_count: int = len(waybill.tracks)
    # declared_value from PP arrives as float | None; Numeric(15,2) accepts Decimal.
    declared_value: Optional[Decimal] = (
        Decimal(str(waybill.details.declared_value))
        if waybill.details.declared_value is not None
        else None
    )

    if consignment is None:
        logger.info("Inserting new Consignment for pp_reference=%s", pp_reference)
        consignment = Consignment(
            id=uuid.uuid4(),
            parcel_perfect_reference=pp_reference,
            client_organization_id=client_org_id,
            trip_id=trip_id,
            origin_precinct_id=origin_precinct_id,
            destination_precinct_id=destination_precinct_id,
            declared_value=declared_value,
            parcel_count_expected=parcel_count,
            unit_count_expected=unit_count_expected,
            pp_manifest_number=waybill.details.manifest,
            pp_raw_json=raw_json,
        )
        db.add(consignment)
    else:
        # trip_id/client_organization_id are set only if currently unset, so a
        # dispatcher-entered or already-resolved value is never clobbered.
        # unit_count_expected is overwritten only when explicitly supplied, so
        # the Celery refresh poll can't blank a dispatcher-entered count.
        logger.info("Updating existing Consignment id=%s for pp_reference=%s", consignment.id, pp_reference)
        consignment.pp_raw_json = raw_json
        consignment.parcel_count_expected = parcel_count
        consignment.pp_manifest_number = waybill.details.manifest
        if trip_id is not None and consignment.trip_id is None:
            consignment.trip_id = trip_id
        if unit_count_expected is not None:
            consignment.unit_count_expected = unit_count_expected
        if consignment.client_organization_id is None:
            consignment.client_organization_id = client_org_id

    # Flush so consignment.id resolves for the Parcel FK below. This is also where
    # the insert race surfaces: the unique constraint on parcel_perfect_reference
    # lets exactly one of two racing callers through and rejects the other (23505).
    try:
        await db.flush()
    except IntegrityError as exc:
        if not is_unique_violation(exc):
            raise
        # Safe to roll back here: every caller already abandons its whole unit of
        # work when the waybill is refused, so a second rollback there is a no-op.
        await db.rollback()
        owner_reference = await get_assigned_trip_reference(db, pp_reference)
        if owner_reference is None:
            # Not "already assigned to another trip" — the row exists on no trip,
            # or the winner rolled back too. A truthful 500 beats a tidy lie.
            logger.error(
                "Unique violation on pp_reference=%s but no owning trip found", pp_reference
            )
            raise
        logger.warning(
            "Lost insert race for consignment pp_reference=%s to trip %s (attempted trip %s)",
            pp_reference, owner_reference, trip_id,
        )
        raise ConsignmentAlreadyAssignedError(pp_reference, owner_reference) from exc

    existing_barcodes_result = await db.execute(
        select(Parcel.barcode).where(Parcel.consignment_id == consignment.id)
    )
    existing_barcodes: set[str] = {row[0] for row in existing_barcodes_result.fetchall()}

    # Insert only barcodes that are new — never delete existing Parcel rows.
    new_parcels_added: int = 0
    for track in waybill.tracks:
        if track.trackno not in existing_barcodes:
            db.add(
                Parcel(
                    id=uuid.uuid4(),
                    consignment_id=consignment.id,
                    barcode=track.trackno,
                    status=ParcelStatus.PENDING,
                )
            )
            new_parcels_added += 1

    if new_parcels_added:
        logger.info(
            "Added %d new Parcel row(s) for consignment id=%s",
            new_parcels_added,
            consignment.id,
        )

    return ConsignmentSyncResult(consignment=consignment, warning=warning)


async def get_assigned_trip_reference(db: AsyncSession, pp_reference: str) -> Optional[str]:
    """Read-only check: is this pp_reference already attached to a trip?

    Used by the wizard-time PP lookup to warn a dispatcher before they add an
    already-claimed waybill. The authoritative fail-closed check still happens
    in fetch_and_sync_consignment at trip creation — this is advisory only.

    Returns None both when no Consignment exists yet and when one exists but
    isn't yet linked to a trip.
    """
    # parcel_perfect_reference is unique, so at most one Consignment can match.
    # .limit(1) kept over scalar_one_or_none(): this advisory read must never
    # raise at a dispatcher mid-lookup.
    result = await db.execute(
        select(Trip.trip_reference)
        .join(Consignment, Consignment.trip_id == Trip.id)
        .where(Consignment.parcel_perfect_reference == pp_reference)
        .limit(1)
    )
    return result.scalars().first()
