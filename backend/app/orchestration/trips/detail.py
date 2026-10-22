"""Trip detail read, plus the two helpers every trip read shares.

Lowest tier of trips/: it imports no trips sibling, so `listing` can build on it without a
cycle. Read-only; the callers (endpoints, phase handshakes, administration) own the
transaction.
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import SubjectType, TripType
from app.db.models.phases import PhaseEvent
from app.db.models.people import Driver
from app.db.models.organisations import Organization
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.phases.blocking import blocked_on_by_stop
from app.orchestration.evidence_anchors.reads import decorate_exception_reads
from app.orchestration.exceptions.review_identity import with_reviewer_names
from app.orchestration.consignments.scans import scanned_counts_for_trip
from app.orchestration.substitutions.access import CompletedCustodyLink, completed_links, derive_custody
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.phases import PhaseEventRead
from app.schemas.pp_manifest import PPManifestRef
from app.schemas.people import DriverRead
from app.schemas.transit import TripExceptionRead
from app.schemas.trips import (
    ConsignmentRead,
    TripDetailResponse,
    TripStopRead,
)
from app.schemas.vehicles import VehicleRead


@dataclass
class TripReadFacts:
    """Rows shared between get_trip_detail and its caller, in both directions.

    Out: the dispatcher trip page adds its driver-handover fields to this read; they need the
    trip, its phases and the drivers, which are already in hand. A caller passes an empty
    instance and get_trip_detail fills it, so the extension does not fetch them a second time.
    `trip` was read with the organisation filter, so the extension may rely on it for tenancy.

    In: a caller that has already read the trip and its completed custody links (the driver's
    access gate does) sets `trip` and `custody_links` first, and get_trip_detail uses them. It
    still checks the trip's id and organisation against its own arguments, so a trip from the
    wrong organisation is refused exactly as the query would refuse it.
    """

    trip: Trip | None = None
    custody_links: Sequence[CompletedCustodyLink] | None = None
    phase_events: Sequence[PhaseEvent] = ()
    drivers: Mapping[uuid.UUID, Driver] = field(default_factory=dict)


async def _client_names(db: AsyncSession, trips: Sequence[Trip]) -> dict[uuid.UUID, str]:
    """Client org names for a page of trips, in one query (no N+1 on list views)."""
    org_ids = {t.client_organization_id for t in trips if t.client_organization_id is not None}
    if not org_ids:
        return {}
    result = await db.execute(
        select(Organization.id, Organization.name).where(Organization.id.in_(org_ids))
    )
    return {org_id: name for org_id, name in result.all()}


def _pp_manifest(trip: Trip, client_names: dict[uuid.UUID, str]) -> PPManifestRef | None:
    return PPManifestRef.from_columns(
        issuer_account=trip.pp_manifest_issuer_account,
        origin_hub=trip.pp_manifest_origin_hub,
        number=trip.pp_manifest_number,
        client_name=(
            client_names.get(trip.client_organization_id)
            if trip.client_organization_id is not None else None
        ),
    )


async def _load_trip_receipts(
    db: AsyncSession, *, trip_id: uuid.UUID, phase_event_ids: list[uuid.UUID], evidence_event_ids: list[uuid.UUID],
) -> Sequence[BlockchainReceipt]:
    """The trip's receipts: its own, its phase events', and its exception actions'.

    H3/H5 anchor a PHASE_EVENT-subject receipt (not a TRIP-subject one — see
    phases.advance_departure/advance_confirmation), so a TRIP-only filter silently hid every
    driver-anchored pickup/delivery receipt from the dispatcher's per-trip evidence view.
    Evidence-event receipts are additionally pinned to this trip's id; the ids passed in are
    this trip's own already, so the pin is a second lock, not the only one.
    """
    result = await db.execute(
        select(BlockchainReceipt)
        .where(
            or_(
                and_(
                    BlockchainReceipt.subject_type == SubjectType.TRIP,
                    BlockchainReceipt.subject_id == trip_id,
                ),
                and_(
                    BlockchainReceipt.subject_type == SubjectType.PHASE_EVENT,
                    BlockchainReceipt.subject_id.in_(phase_event_ids),
                ),
                and_(
                    BlockchainReceipt.subject_type == SubjectType.EVIDENCE_EVENT,
                    BlockchainReceipt.subject_id.in_(evidence_event_ids),
                    BlockchainReceipt.trip_id == trip_id,
                ),
            )
        )
        .order_by(BlockchainReceipt.created_at, BlockchainReceipt.id)
    )
    return result.scalars().all()


async def get_trip_detail(
    db: AsyncSession,
    trip_id: uuid.UUID,
    operator_organization_id: uuid.UUID,
    *,
    include_reviewer_names: bool = False,
    facts: TripReadFacts | None = None,
) -> TripDetailResponse:
    """Raises ResourceNotFoundError if trip not found or belongs to a different org.

    `facts`, when given, is filled with the trip, phase events and drivers this read loaded."""
    if facts is not None and facts.trip is not None:
        # Read by the caller; the same two conditions the query below applies.
        trip = facts.trip
        if trip.id != trip_id or trip.operator_organization_id != operator_organization_id:
            raise ResourceNotFoundError("Trip", str(trip_id))
    else:
        # Filter by org at the DB level — avoids leaking trip existence to other orgs.
        result = await db.execute(
            select(Trip).where(
                Trip.id == trip_id,
                Trip.operator_organization_id == operator_organization_id,
            )
        )
        trip = result.scalar_one_or_none()
        if trip is None:
            raise ResourceNotFoundError("Trip", str(trip_id))

    client_names = await _client_names(db, [trip])
    # FP-83: `driver` is whoever holds the trip now; Trip.driver_id stays the journey lock's original.
    links = (
        facts.custody_links if facts is not None and facts.custody_links is not None
        else await completed_links(db, trip_id=trip.id)
    )
    custody = derive_custody(trip.driver_id, links)
    drivers = {d.id: d for d in (await db.execute(
        select(Driver).where(Driver.id.in_({trip.driver_id, custody.driver_id}))
    )).scalars()}
    driver = drivers[custody.driver_id]

    horse_result = await db.execute(select(Vehicle).where(Vehicle.id == trip.horse_id))
    horse = horse_result.scalar_one()

    tt_result = await db.execute(
        select(TripTrailer).where(TripTrailer.trip_id == trip_id)
    )
    trip_trailers = tt_result.scalars().all()
    trailer_ids = [tt.trailer_id for tt in trip_trailers]
    trailers_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(trailer_ids)))
    trailers_by_id = {v.id: v for v in trailers_result.scalars().all()}
    trailers = [trailers_by_id[tid] for tid in trailer_ids if tid in trailers_by_id]

    hs_result = await db.execute(
        select(PhaseEvent)
        .where(PhaseEvent.trip_id == trip_id)
        .order_by(PhaseEvent.sequence_number)
    )
    phase_events = hs_result.scalars().all()

    exc_result = await db.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )
    exceptions = exc_result.scalars().all()
    exception_reads = await decorate_exception_reads(
        db, exceptions, [TripExceptionRead.model_validate(e) for e in exceptions],
    )
    if include_reviewer_names:
        # Dispatcher trip page only. The same builder serves the driver's active trip
        # and phase completion, which must not carry dispatcher identities.
        exception_reads = await with_reviewer_names(
            db, organization_id=operator_organization_id, reads=exception_reads,
        )

    receipts = await _load_trip_receipts(
        db, trip_id=trip_id, phase_event_ids=[h.id for h in phase_events],
        # Critical-evidence receipts hang off evidence events, not the exception. The events
        # were just read with the exceptions, so no extra lookup is needed to name them.
        evidence_event_ids=[e.event_id for read in exception_reads for e in read.anchor_events],
    )

    stops_result = await db.execute(
        select(TripStop).where(TripStop.trip_id == trip_id).order_by(TripStop.sequence)
    )
    stops = stops_result.scalars().all()

    # PhaseEventRead.stop_sequence is a join, not a column — build the map from
    # the stops already fetched rather than issuing a second query.
    stop_sequence_by_id = {s.id: s.sequence for s in stops}

    # Hoisted out of the phases=[...] comprehension below: one gate query for the
    # whole trip, not one per phase event.
    gate = await blocked_on_by_stop(db, trip_id=trip_id)

    # id tiebreaker: consignments inserted in one transaction share the same
    # created_at (Postgres now() is per-transaction), so created_at alone is
    # non-deterministic across reads.
    consignments_result = await db.execute(
        select(Consignment)
        .where(Consignment.trip_id == trip_id)
        .order_by(Consignment.created_at, Consignment.id)
    )
    consignments = consignments_result.scalars().all()

    # One batched query for the whole trip's live scan progress — see its docstring
    # for why this must not become a per-consignment loop on a dispatcher poll path.
    scan_counts = await scanned_counts_for_trip(db, trip_id=trip_id)
    consignment_reads = [
        ConsignmentRead.model_validate(c).model_copy(update={
            "scanned_out_count": scan_counts[c.id].scanned_out if c.id in scan_counts else 0,
            "scanned_in_count": scan_counts[c.id].scanned_in if c.id in scan_counts else 0,
        })
        for c in consignments
    ]

    if facts is not None:
        facts.trip, facts.custody_links, facts.phase_events, facts.drivers = trip, links, phase_events, drivers

    return TripDetailResponse(
        id=trip.id,
        trip_reference=trip.trip_reference,
        pp_manifest=_pp_manifest(trip, client_names),
        status=trip.status,
        trip_type=TripType(trip.trip_type),
        journey_lock_hash=trip.journey_lock_hash,
        idvs_check_status=trip.idvs_check_status,
        driver=DriverRead.model_validate(driver),
        original_driver=DriverRead.model_validate(drivers[trip.driver_id]),
        custody_sequence=custody.sequence,
        horse=VehicleRead.model_validate(horse),
        trailers=[VehicleRead.model_validate(v) for v in trailers],
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        stops=[TripStopRead.model_validate(s) for s in stops],
        consignments=consignment_reads,
        pulsit_trip_reference_id=trip.pulsit_trip_reference_id,
        planned_departure_at=trip.planned_departure_at,
        actual_departure_at=trip.actual_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
        actual_arrival_at=trip.actual_arrival_at,
        closed_at=trip.closed_at,
        current_phase=trip.current_phase,
        current_stop=trip.current_stop,
        phases=[
            PhaseEventRead.from_event(
                e, stop_sequence_by_id=stop_sequence_by_id, blocked_on_by_stop=gate,
            )
            for e in phase_events
        ],
        exceptions=exception_reads,
        blockchain_receipts=[BlockchainReceiptRead.model_validate(r) for r in receipts],
        warnings=[],
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )

