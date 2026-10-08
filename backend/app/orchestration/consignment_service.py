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

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConsignmentAlreadyAssignedError, ConsignmentScannedOnCancelledTripError
from app.db.models.enums import ParcelStatus, TripStatus
from app.db.models.organisations import Organization
from app.db.models.trips import Consignment, Parcel, Trip
from app.integrations.parcel_perfect.factory import get_pp_client
from app.integrations.parcel_perfect.models import PPWaybillResponse
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
    pp_manifest_number are refreshed and returned. Ordinary refreshes only add parcels;
    moving unscanned cargo off a cancelled trip rebuilds its expected set. The caller
    is responsible for db.commit().

    Concurrency is held by two complementary guards, since one waybill must never
    end up on two trips each anchoring its own journey-lock hash: FOR UPDATE below
    locks an existing row against reassignment, and the unique constraint on
    parcel_perfect_reference arbitrates two callers racing to insert the first row
    (which nothing can lock beforehand).

    Raises:
        ConsignmentAlreadyAssignedError: see sync_consignment_from_waybill.
        Any exception from get_pp_client().get_single_waybill() propagates unchanged.
    """
    # Fetched first so a PP error aborts before any DB interaction.
    logger.info("fetch_and_sync_consignment pp_reference=%s", pp_reference)
    waybill: PPWaybillResponse = await get_pp_client().get_single_waybill(pp_reference)
    return await sync_consignment_from_waybill(
        db, waybill, trip_id=trip_id, unit_count_expected=unit_count_expected,
        origin_precinct_id=origin_precinct_id, destination_precinct_id=destination_precinct_id,
    )


async def sync_consignment_from_waybill(
    db: AsyncSession,
    waybill: PPWaybillResponse,
    *,
    trip_id: Optional[uuid.UUID] = None,
    unit_count_expected: Optional[int] = None,
    origin_precinct_id: Optional[uuid.UUID] = None,
    destination_precinct_id: Optional[uuid.UUID] = None,
) -> ConsignmentSyncResult:
    """Upsert a waybill PP has already returned — no PP call (FP-281 §10.2 step 6: the
    manifest carries full waybills, and a second read could disagree with the snapshot
    just hashed). Same idempotency and concurrency guarantees as fetch_and_sync_consignment.

    Raises:
        ConsignmentAlreadyAssignedError: the waybill is on another trip that is not
            cancelled, whether visible on entry or only after losing the insert race.
        ConsignmentScannedOnCancelledTripError: it is on a cancelled trip and parcels
            were scanned there.
    """
    pp_reference = waybill.details.waybill
    # FOR UPDATE holds the row for the rest of this transaction, so a second caller
    # at the same waybill waits here rather than reading a trip_id about to change
    # underneath it. Without it, two callers could both read trip_id=None and both
    # write their own trip_id below, silently taking the cargo off the earlier trip.
    existing_result = await db.execute(
        select(Consignment)
        .where(Consignment.parcel_perfect_reference == pp_reference)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    consignment: Optional[Consignment] = existing_result.scalar_one_or_none()

    # Moving a waybill between trips is refused unless its trip was cancelled and
    # nothing on it was scanned (see _release_from_cancelled_trip). Same trip_id is not
    # a conflict — that's the Celery refresh poll re-syncing onto the trip it already has.
    if (
        consignment is not None
        and consignment.trip_id is not None
        and trip_id is not None
        and consignment.trip_id != trip_id
    ):
        await _release_from_cancelled_trip(
            db, consignment, pp_reference=pp_reference, new_trip_id=trip_id,
        )

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
            # Attaching (or re-attaching after a cancelled trip): the leg is this trip's.
            if origin_precinct_id is not None:
                consignment.origin_precinct_id = origin_precinct_id
            if destination_precinct_id is not None:
                consignment.destination_precinct_id = destination_precinct_id
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


async def scanned_consignment_ids(
    db: AsyncSession, consignment_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """Which of these consignments have at least one parcel carrying a scan stamp."""
    if not consignment_ids:
        return set()
    result = await db.execute(
        select(Parcel.consignment_id)
        .where(
            Parcel.consignment_id.in_(consignment_ids),
            or_(Parcel.pp_scan_out_at.is_not(None), Parcel.pp_scan_in_at.is_not(None)),
        )
        .distinct()
    )
    return set(result.scalars().all())


async def _release_from_cancelled_trip(
    db: AsyncSession, consignment: Consignment, *, pp_reference: str, new_trip_id: uuid.UUID,
) -> None:
    """Take a waybill off its trip so new_trip_id can claim it — only when that trip
    was cancelled and nothing on the waybill was scanned (spec §10.5).

    Everything else is refused, as before: the caller's restamping of pickup/delivery
    stops would otherwise silently rewrite an anchored trip's route basis. Scanned
    parcels stay because scan stamps are first-write-wins (scan_service._stamp_parcel):
    moving them would carry the cancelled trip's scans onto the new trip and hide the
    real reload scans.

    Raises:
        ConsignmentAlreadyAssignedError: the owning trip is not cancelled.
        ConsignmentScannedOnCancelledTripError: it is cancelled, but parcels were scanned.
    """
    owner = (await db.execute(
        select(Trip.trip_reference, Trip.status).where(Trip.id == consignment.trip_id)
    )).one_or_none()
    owner_reference = owner.trip_reference if owner is not None else str(consignment.trip_id)
    if owner is None or owner.status != TripStatus.CANCELLED:
        logger.warning(
            "Rejected reassignment of consignment pp_reference=%s from trip %s to trip %s",
            pp_reference, consignment.trip_id, new_trip_id,
        )
        raise ConsignmentAlreadyAssignedError(pp_reference, owner_reference)
    if consignment.id in await scanned_consignment_ids(db, [consignment.id]):
        logger.warning(
            "Refused moving scanned consignment pp_reference=%s off cancelled trip %s",
            pp_reference, owner_reference,
        )
        raise ConsignmentScannedOnCancelledTripError(pp_reference, owner_reference)

    logger.info(
        "Moving consignment pp_reference=%s off cancelled trip %s to trip %s",
        pp_reference, owner_reference, new_trip_id,
    )
    # Safe to discard: no stamps (checked above), and scan ingestion waits on this same
    # consignment lock. The replacement's expected parcels come from its own PP read.
    await db.execute(delete(Parcel).where(Parcel.consignment_id == consignment.id))
    consignment.unit_count_expected = None
    consignment.trip_id = None
    # The cancelled trip's stops; the caller stamps the new route's stops after sync.
    consignment.pickup_stop_id = None
    consignment.delivery_stop_id = None


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
