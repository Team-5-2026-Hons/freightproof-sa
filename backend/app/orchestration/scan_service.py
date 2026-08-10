"""Warehouse scan reconciliation — expected set vs observed set, per stop.

This is production code. The dev trigger panel is one caller; a Celery poll against
a real WMS feed would be another, and neither changes what happens here.

The expected set is Parcel Perfect's tracks[], already persisted as Parcel rows and
partitioned per stop by Consignment.pickup_stop_id / delivery_stop_id (FP-112). The
observed set comes from the ScanFeed. Any difference between them is an evidence
event, scoped to the consignment and the stop so a multi-client trip's evidence can
be cut per client (v7 §6.1).

This module is the first writer of Parcel.pp_scan_out_at / pp_scan_in_at and the
first writer of TripException.consignment_id / trip_stop_id — both documented in
the models as existing but unpopulated.

Layering: orchestration → integrations, db. Never imports from api/.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, ParcelStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.integrations.scan_feed import ScanDirection, ScanEvent, get_scan_feed

logger = logging.getLogger(__name__)

# A discrepancy is a warning, not a critical: the exception_service's critical set
# is seals and panic buttons — events that stop a trip. A count difference at the
# door is recorded and reviewed, it does not halt anything (FreightProof records,
# it does not operate).
_DISCREPANCY_SEVERITY = ExceptionSeverity.WARNING

# The warehouse scanned it, not a human in our system, so the source is the system.
_DISCREPANCY_SOURCE = ExceptionSource.SYSTEM


@dataclass(frozen=True)
class ConsignmentScanResult:
    """Reconciliation outcome for one consignment at one stop."""

    consignment_id: uuid.UUID
    parcel_perfect_reference: str
    expected_count: int
    observed_count: int
    matched_barcodes: list[str] = field(default_factory=list)
    missing_barcodes: list[str] = field(default_factory=list)
    unexpected_barcodes: list[str] = field(default_factory=list)
    exception_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True)
class ScanIngestResult:
    """Everything that happened across every consignment at this stop."""

    trip_id: uuid.UUID
    trip_stop_id: uuid.UUID
    direction: ScanDirection
    consignments: list[ConsignmentScanResult]


@dataclass(frozen=True)
class ScannedCounts:
    """Live scan tallies for one consignment, read from Parcel rows.

    Deliberately NOT read from PhaseEvent.parcel_count_origin / _destination.
    Those are aggregates cached at phase close; reading one to make a decision
    reintroduces staleness by the back door (design §2.1).
    """

    expected: int
    scanned_out: int
    scanned_in: int


async def load_consignments_at_stop(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID, direction: ScanDirection,
) -> list[Consignment]:
    """Consignments whose pickup (OUT) or delivery (IN) stop is this stop.

    Public because the dev trigger endpoint needs the same resolution to know
    which consignments to stage barcodes for — reaching into a private helper
    across modules would be a worse coupling than exposing the real one.

    Scoping by direction is what makes a cross-dock trip work: at the middle stop
    of a CPT→BFN→JHB run, some consignments are being dropped and others collected,
    and reconciling all of them against one scan would guarantee a false mismatch.

    Raises:
        ResourceNotFoundError: the stop does not exist, or does not belong to the trip.
    """
    stop = (await db.execute(
        select(TripStop).where(TripStop.id == trip_stop_id, TripStop.trip_id == trip_id)
    )).scalar_one_or_none()
    if stop is None:
        raise ResourceNotFoundError("TripStop", str(trip_stop_id))

    stop_column = (
        Consignment.pickup_stop_id if direction is ScanDirection.OUT
        else Consignment.delivery_stop_id
    )
    result = await db.execute(
        select(Consignment)
        .where(Consignment.trip_id == trip_id, stop_column == trip_stop_id)
        .order_by(Consignment.created_at)
    )
    return list(result.scalars().all())


async def scanned_counts_for_consignment(
    db: AsyncSession, *, consignment_id: uuid.UUID,
) -> ScannedCounts:
    """Count this consignment's parcels, and how many carry each scan stamp.

    func.count(column) counts non-NULL values of that column — exactly "how many
    parcels carry this stamp" for pp_scan_out_at / pp_scan_in_at. func.count(Parcel.id)
    counts rows, since Parcel.id is never NULL, giving the expected total.
    """
    result = await db.execute(
        select(
            func.count(Parcel.id),
            func.count(Parcel.pp_scan_out_at),
            func.count(Parcel.pp_scan_in_at),
        ).where(Parcel.consignment_id == consignment_id)
    )
    expected, scanned_out, scanned_in = result.one()
    return ScannedCounts(
        expected=expected, scanned_out=scanned_out, scanned_in=scanned_in,
    )


async def scanned_counts_for_trip(
    db: AsyncSession, *, trip_id: uuid.UUID,
) -> dict[uuid.UUID, ScannedCounts]:
    """Live scan tallies for every consignment on a trip, keyed by consignment_id.

    One grouped query, not scanned_counts_for_consignment called in a loop:
    get_trip_detail renders this on every dispatcher poll, so an N+1 here would be
    N+1 on every poll of every open trip. Same func.count(column)-counts-non-NULL
    trick as scanned_counts_for_consignment, joined to Consignment so the trip_id
    filter can be applied without a subquery.

    LEFT OUTER JOIN, not an inner join: a consignment with no Parcel rows yet
    (PP sync degraded, or parcels not yet materialised) must still come back with
    zeros so the caller can render it, not be silently absent from the map.
    """
    result = await db.execute(
        select(
            Consignment.id,
            func.count(Parcel.id),
            func.count(Parcel.pp_scan_out_at),
            func.count(Parcel.pp_scan_in_at),
        )
        .select_from(Consignment)
        .outerjoin(Parcel, Parcel.consignment_id == Consignment.id)
        .where(Consignment.trip_id == trip_id)
        .group_by(Consignment.id)
    )
    return {
        consignment_id: ScannedCounts(expected=expected, scanned_out=scanned_out, scanned_in=scanned_in)
        for consignment_id, expected, scanned_out, scanned_in in result.all()
    }


async def ingest_scans(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID, direction: ScanDirection,
) -> ScanIngestResult:
    """Pull scans from the feed for this stop and reconcile them against the manifest.

    Writes Parcel.pp_scan_out_at / pp_scan_in_at and the matching ParcelStatus, and
    raises a TripException per consignment that has missing or unexpected barcodes.

    Idempotent: an already-stamped parcel keeps its original timestamp (the first
    scan is the evidence), and an identical unresolved discrepancy is not raised
    twice — a repeated poll against an unchanged feed must not manufacture rows.

    The caller is responsible for db.commit().

    Raises:
        ResourceNotFoundError: the trip or the stop does not exist, or the stop
        does not belong to the trip.
    """
    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    stop = (await db.execute(
        select(TripStop).where(TripStop.id == trip_stop_id, TripStop.trip_id == trip_id)
    )).scalar_one_or_none()
    if stop is None:
        raise ResourceNotFoundError("TripStop", str(trip_stop_id))

    feed = get_scan_feed()
    consignments = await load_consignments_at_stop(
        db, trip_id=trip_id, trip_stop_id=trip_stop_id, direction=direction,
    )
    results: list[ConsignmentScanResult] = []

    for consignment in consignments:
        events: list[ScanEvent] = await feed.poll_scans(
            consignment_reference=consignment.parcel_perfect_reference,
            stop_reference=str(trip_stop_id),
            direction=direction,
        )
        results.append(
            await _reconcile_consignment(
                db, trip_id=trip_id, trip_stop_id=trip_stop_id,
                consignment=consignment, events=events, direction=direction,
            )
        )

    await db.flush()
    logger.info(
        "ingest_scans trip=%s stop=%s direction=%s consignments=%d",
        trip_id, trip_stop_id, direction.value, len(results),
    )
    return ScanIngestResult(
        trip_id=trip_id, trip_stop_id=trip_stop_id, direction=direction, consignments=results,
    )


async def _reconcile_consignment(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID,
    consignment: Consignment, events: list[ScanEvent], direction: ScanDirection,
) -> ConsignmentScanResult:
    """Compare one consignment's expected parcels against what was scanned."""
    parcels = list((await db.execute(
        select(Parcel).where(Parcel.consignment_id == consignment.id)
    )).scalars().all())
    parcels_by_barcode: dict[str, Parcel] = {p.barcode: p for p in parcels}

    observed_barcodes = [e.barcode for e in events]
    scanned_at_by_barcode = {e.barcode: e.scanned_at for e in events}

    matched = [b for b in observed_barcodes if b in parcels_by_barcode]
    unexpected = [b for b in observed_barcodes if b not in parcels_by_barcode]
    missing = [p.barcode for p in parcels if p.barcode not in set(observed_barcodes)]

    for barcode in matched:
        parcel = parcels_by_barcode[barcode]
        _stamp_parcel(parcel, direction=direction, scanned_at=scanned_at_by_barcode[barcode])

    exception_ids: list[uuid.UUID] = []
    if events and (missing or unexpected):
        exception_id = await _raise_discrepancy(
            db, trip_id=trip_id, trip_stop_id=trip_stop_id, consignment=consignment,
            direction=direction, missing=missing, unexpected=unexpected,
            expected_count=len(parcels), observed_count=len(observed_barcodes),
        )
        if exception_id is not None:
            exception_ids.append(exception_id)

    return ConsignmentScanResult(
        consignment_id=consignment.id,
        parcel_perfect_reference=consignment.parcel_perfect_reference,
        expected_count=len(parcels),
        observed_count=len(observed_barcodes),
        matched_barcodes=matched,
        missing_barcodes=missing,
        unexpected_barcodes=unexpected,
        exception_ids=exception_ids,
    )


def _stamp_parcel(parcel: Parcel, *, direction: ScanDirection, scanned_at: datetime) -> None:
    """Record the scan on the parcel, first-write-wins.

    An already-stamped parcel keeps its original timestamp: the first scan is the
    evidence, and a replayed poll must not rewrite when it happened.
    """
    if direction is ScanDirection.OUT:
        if parcel.pp_scan_out_at is None:
            parcel.pp_scan_out_at = scanned_at
            parcel.status = ParcelStatus.SCANNED_OUT
    else:
        if parcel.pp_scan_in_at is None:
            parcel.pp_scan_in_at = scanned_at
            parcel.status = ParcelStatus.SCANNED_IN


async def _raise_discrepancy(
    db: AsyncSession, *, trip_id: uuid.UUID, trip_stop_id: uuid.UUID,
    consignment: Consignment, direction: ScanDirection,
    missing: list[str], unexpected: list[str],
    expected_count: int, observed_count: int,
) -> uuid.UUID | None:
    """Record a scan discrepancy, unless an identical unresolved one already exists.

    Returns the new exception's id, or None when a duplicate was suppressed.

    An unexpected barcode reuses PARCEL_COUNT_MISMATCH rather than introducing a new
    ExceptionType: db/models/enums.py is read by every branch and mirrored by the
    dispatcher's TripContext.tsx, so a new value is a coordination cost this does not
    need. The barcode itself is named in the description, so nothing is lost.
    """
    description = _build_discrepancy_description(
        reference=consignment.parcel_perfect_reference, direction=direction,
        missing=missing, unexpected=unexpected,
        expected_count=expected_count, observed_count=observed_count,
    )

    # Determine which phase this scan belongs to based on direction
    phase_type = 'loading' if direction == ScanDirection.OUT else 'unloading'

    # Look up the phase_event_id for this scan at this stop
    phase_event = (await db.execute(
        select(PhaseEvent.id).where(
            PhaseEvent.trip_id == trip_id,
            PhaseEvent.trip_stop_id == trip_stop_id,
            PhaseEvent.phase_type == phase_type,
        )
    )).scalar_one_or_none()

    # Suppress an identical unresolved duplicate. A repeated poll against an
    # unchanged feed is a normal occurrence, and each repeat manufacturing a new
    # exception row would bury the real one under noise on the dispatcher's list.
    existing = (await db.execute(
        select(TripException.id).where(
            TripException.trip_id == trip_id,
            TripException.consignment_id == consignment.id,
            TripException.trip_stop_id == trip_stop_id,
            TripException.exception_type == ExceptionType.PARCEL_COUNT_MISMATCH,
            TripException.description == description,
            TripException.resolved.is_(False),
        )
    )).scalar_one_or_none()
    if existing is not None:
        logger.info(
            "Suppressed duplicate scan discrepancy for consignment=%s stop=%s",
            consignment.id, trip_stop_id,
        )
        return None

    exception = TripException(
        id=uuid.uuid4(),
        trip_id=trip_id,
        phase_event_id=phase_event,  # ← Now properly attached
        consignment_id=consignment.id,
        trip_stop_id=trip_stop_id,
        exception_type=ExceptionType.PARCEL_COUNT_MISMATCH,
        source=_DISCREPANCY_SOURCE,
        severity=_DISCREPANCY_SEVERITY,
        description=description,
    )
    db.add(exception)
    logger.warning("Scan discrepancy recorded: %s", description)
    return exception.id


def _build_discrepancy_description(
    *, reference: str, direction: ScanDirection, missing: list[str], unexpected: list[str],
    expected_count: int, observed_count: int,
) -> str:
    """Human-readable discrepancy summary. Deterministic — duplicate suppression
    above compares on this exact string."""
    action = "scan-out" if direction is ScanDirection.OUT else "scan-in"
    parts = [
        f"Warehouse {action} discrepancy on waybill {reference}: "
        f"expected {expected_count} parcel(s), scanned {observed_count}."
    ]
    if missing:
        parts.append(f"Not scanned: {', '.join(sorted(missing))}.")
    if unexpected:
        parts.append(f"Scanned but not on the manifest: {', '.join(sorted(unexpected))}.")
    return " ".join(parts)
