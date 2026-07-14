"""Consignment sync service — maps a PPWaybillResponse onto Consignment + Parcel DB rows.

Called at trip creation to pull waybill data from Parcel Perfect and persist it.
Idempotent: a second call for the same (pp_reference, client_organization_id) pair
updates the existing row rather than inserting a duplicate.

Layering: orchestration → integrations, db. Never imports from api/ or auth/.
"""

import logging
import uuid
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ParcelStatus
from app.db.models.trips import Consignment, Parcel
from app.integrations.parcel_perfect import PPWaybillResponse, get_pp_client

logger = logging.getLogger(__name__)


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
    client_organization_id: uuid.UUID,
    trip_id: Optional[uuid.UUID] = None,
    origin_precinct_id: Optional[uuid.UUID] = None,
    destination_precinct_id: Optional[uuid.UUID] = None,
) -> Consignment:
    """Fetch a waybill from Parcel Perfect and upsert it into the DB.

    Idempotent: if a Consignment with the same (pp_reference, client_organization_id)
    already exists, its pp_raw_json and parcel_count_expected are refreshed and the
    existing row is returned. Parcel rows are never deleted — only new barcodes are
    inserted. The caller is responsible for db.commit().

    Raises:
        Any exception raised by get_pp_client().get_single_waybill() propagates
        unchanged so callers can handle PP-specific errors (e.g. waybill not found).
    """
    # Step 1: Fetch fresh waybill data from PP (or mock).
    # We do this first so a PP error aborts before any DB interaction.
    logger.info(
        "fetch_and_sync_consignment pp_reference=%s client_organization_id=%s",
        pp_reference,
        client_organization_id,
    )
    waybill: PPWaybillResponse = await get_pp_client().get_single_waybill(pp_reference)

    # Step 2: Look for an existing Consignment for this (reference, client) pair.
    existing_result = await db.execute(
        select(Consignment).where(
            Consignment.parcel_perfect_reference == pp_reference,
            Consignment.client_organization_id == client_organization_id,
        )
    )
    consignment: Optional[Consignment] = existing_result.scalar_one_or_none()

    raw_json: dict[str, Any] = _serialise_waybill(waybill)
    parcel_count: int = len(waybill.tracks)
    # declared_value from PP arrives as float | None; Numeric(15,2) accepts Decimal.
    declared_value: Optional[Decimal] = (
        Decimal(str(waybill.details.declared_value))
        if waybill.details.declared_value is not None
        else None
    )

    if consignment is None:
        # Step 3: First time we see this consignment — insert a new row.
        logger.info("Inserting new Consignment for pp_reference=%s", pp_reference)
        consignment = Consignment(
            id=uuid.uuid4(),
            parcel_perfect_reference=pp_reference,
            client_organization_id=client_organization_id,
            trip_id=trip_id,
            origin_precinct_id=origin_precinct_id,
            destination_precinct_id=destination_precinct_id,
            declared_value=declared_value,
            parcel_count_expected=parcel_count,
            pp_raw_json=raw_json,
        )
        db.add(consignment)
    else:
        # Step 4: Refresh mutable fields on the existing row.
        # trip_id is set only if the existing row has none — prevents accidental
        # overwrite if the consignment was already linked to a different trip.
        logger.info("Updating existing Consignment id=%s for pp_reference=%s", consignment.id, pp_reference)
        consignment.pp_raw_json = raw_json
        consignment.parcel_count_expected = parcel_count
        if trip_id is not None and consignment.trip_id is None:
            consignment.trip_id = trip_id

    # Step 5: Flush so consignment.id is resolved and can be used as a FK on Parcel rows.
    await db.flush()

    # Step 6: Gather barcodes that already exist for this consignment (deduplication guard).
    existing_barcodes_result = await db.execute(
        select(Parcel.barcode).where(Parcel.consignment_id == consignment.id)
    )
    existing_barcodes: set[str] = {row[0] for row in existing_barcodes_result.fetchall()}

    # Step 7: Insert only barcodes that are new — never delete existing Parcel rows.
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

    return consignment
