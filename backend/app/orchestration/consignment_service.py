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
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ParcelStatus
from app.db.models.organisations import Organization
from app.db.models.trips import Consignment, Parcel
from app.integrations.parcel_perfect import PPWaybillResponse, get_pp_client

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConsignmentSyncResult:
    """Result of a sync — the upserted row plus a non-fatal warning, if any."""

    consignment: Consignment
    warning: str | None  # e.g. unmapped PP account — surfaced, never fatal


def _serialise_waybill(w: PPWaybillResponse) -> dict[str, Any]:
    """Convert a PPWaybillResponse to a JSON-safe dict for storage in pp_raw_json.

    Dataclasses are not JSON-serialisable by default, so we flatten each nested
    object into plain dicts. Stored verbatim in JSONB — no lossy type coercion.
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
    (accnum → Organization.pp_account_number), not supplied by the caller —
    PP is the source of truth for which client a consignment belongs to.
    An unmapped accnum is not fatal: the consignment is still saved (with
    client_organization_id=None) and a warning is returned for the caller
    to surface to the dispatcher.

    Idempotent under non-concurrent calls (no DB unique constraint on
    parcel_perfect_reference yet — the select-then-insert has a race window;
    see schema follow-up): if a Consignment with the same pp_reference already
    exists, its pp_raw_json, parcel_count_expected, and pp_manifest_number are
    refreshed and the existing row is returned. Parcel rows are never deleted —
    only new barcodes are inserted. The caller is responsible for db.commit().

    Raises:
        Any exception raised by get_pp_client().get_single_waybill() propagates
        unchanged so callers can handle PP-specific errors (e.g. waybill not found).
    """
    # Step 1: Fetch fresh waybill data from PP (or mock).
    # We do this first so a PP error aborts before any DB interaction.
    logger.info("fetch_and_sync_consignment pp_reference=%s", pp_reference)
    waybill: PPWaybillResponse = await get_pp_client().get_single_waybill(pp_reference)

    # Step 2: Look for an existing Consignment for this pp_reference.
    # Rekeyed on pp_reference alone — PP waybill numbers are unique within a
    # PP instance, and client org is now derived rather than caller-supplied.
    existing_result = await db.execute(
        select(Consignment).where(Consignment.parcel_perfect_reference == pp_reference)
    )
    consignment: Optional[Consignment] = existing_result.scalar_one_or_none()

    # Step 3: Resolve the client org from the waybill's PP account number.
    # accnum is PP's source of truth for client attribution — the caller no
    # longer supplies client_organization_id. Skipped when the consignment is
    # already linked to a client org: re-querying on every Celery refresh is
    # wasted work, and a later org-row deletion would otherwise emit a spurious
    # "no matching organization" warning for an already-attributed consignment.
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

    raw_json: dict[str, Any] = _serialise_waybill(waybill)
    parcel_count: int = len(waybill.tracks)
    # declared_value from PP arrives as float | None; Numeric(15,2) accepts Decimal.
    declared_value: Optional[Decimal] = (
        Decimal(str(waybill.details.declared_value))
        if waybill.details.declared_value is not None
        else None
    )

    if consignment is None:
        # Step 4: First time we see this consignment — insert a new row.
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
        # Step 5: Refresh mutable fields on the existing row.
        # trip_id is set only if the existing row has none — prevents accidental
        # overwrite if the consignment was already linked to a different trip.
        # unit_count_expected is only overwritten when explicitly supplied —
        # the Celery refresh poll must not blank a dispatcher-entered count.
        # client_organization_id is re-resolved only if currently unset, so a
        # later org mapping can heal a previously-unmapped consignment without
        # clobbering an already-resolved (or manually corrected) attribution.
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

    # Step 6: Flush so consignment.id is resolved and can be used as a FK on Parcel rows.
    await db.flush()

    # Step 7: Gather barcodes that already exist for this consignment (deduplication guard).
    existing_barcodes_result = await db.execute(
        select(Parcel.barcode).where(Parcel.consignment_id == consignment.id)
    )
    existing_barcodes: set[str] = {row[0] for row in existing_barcodes_result.fetchall()}

    # Step 8: Insert only barcodes that are new — never delete existing Parcel rows.
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
