"""FP-149 read orchestration. All journey history is projected, never persisted."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.core.pagination import CursorPosition, decode_cursor, encode_cursor
from app.orchestration.parcel_trace.projection import project_journey
from app.orchestration.parcel_trace.queries import journey_query, load_journeys, load_records, lookup_matches
from app.schemas.parcel_trace import (
    LOOKUP_PAGE_SIZE, ParcelLookupQuery, ParcelLookupResponse, ParcelTraceQuery, ParcelTraceResponse,
)

_COVERAGE_NOTE = (
    "History is derived from phase events for current assignments and retained creation manifests. "
    "Earlier associations absent from both sources cannot be reconstructed. "
    "Location and seal evidence describe the consignment's vehicle, not a direct observation of the parcel."
)


async def lookup_parcels(
    db: AsyncSession, *, organization_id: UUID, query: ParcelLookupQuery,
) -> ParcelLookupResponse:
    matches = await lookup_matches(db, organization_id, query)
    return ParcelLookupResponse(
        barcode=query.barcode, items=matches[:LOOKUP_PAGE_SIZE],
        next_after=matches[LOOKUP_PAGE_SIZE - 1].waybill_reference if len(matches) > LOOKUP_PAGE_SIZE else None,
    )


async def trace_parcel(
    db: AsyncSession, *, organization_id: UUID, query: ParcelTraceQuery,
) -> ParcelTraceResponse:
    position = decode_cursor(query.cursor) if query.cursor else None
    stmt = journey_query(organization_id, query.barcode, query.waybill_reference)
    trips = await load_journeys(db, stmt, position, query.limit)
    if not trips and position is None:
        raise ResourceNotFoundError("Parcel trace", query.barcode)
    visible = trips[:query.limit]
    records = await load_records(db, visible, query.barcode, query.waybill_reference)
    cursor = None
    if len(trips) > query.limit:
        last = visible[-1]
        cursor = encode_cursor(CursorPosition(created_at=last.created_at, id=last.id))
    return ParcelTraceResponse(
        barcode=query.barcode, waybill_reference=query.waybill_reference,
        journeys=[project_journey(record) for record in records], next_cursor=cursor, coverage_note=_COVERAGE_NOTE,
    )
