"""Drift guard between scripts/seed_trips.py and the PP mock fixture library.

These two drifted apart once already: the seeder invented references
(MOCKWB0001-0007) that MOCK_WAYBILLS had never contained, so every seeded trip
looked fine in the database while the dispatcher wizard's fail-closed PP lookup
returned 404 for the platform's own demo data. Nothing failed - there was no test
that could fail - until someone typed a seeded waybill into the wizard.

This file is that test. It imports the seeder's spec rather than duplicating it,
so a reference added to one side and not the other fails the build.
"""

from datetime import UTC, datetime
from decimal import Decimal
import uuid

import pytest

from app.integrations.parcel_perfect import (
    MOCK_WAYBILLS, DEMO_HUB_CODES, MOCK_MANIFEST_HEADERS,
    SEEDED_WAYBILLS,
    UNASSIGNED_WAYBILLS,
    MockParcelPerfectClient,
)
from app.db.models.enums import ParcelStatus, PhaseType, SealCondition
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Parcel
from app.orchestration.phase_plan import PlanStop, build_phase_plan
from scripts.seed_demo import _PRECINCTS as DEMO_PRECINCTS
from scripts.seed_trips import (
    _manifest_key_for,
    _apply_walk_evidence,
    _apply_seed_position_evidence,
    _apply_seed_scan_evidence,
    _position_for_event,
    _trailer_snapshot_for_event,
    SEEDED_WAYBILL_REFERENCES,
    TRIP_CREATION_SEQUENCE,
    TRIP_SPECS,
    resolved_sequences,
)

# Expected plan length per seeded trip, keyed by trip_reference. Stated here rather
# than computed so a change to build_phase_plan that silently reshapes the demo
# trips has to be acknowledged: 2 stops -> 8 rows, 3-stop cross-dock -> 13.
_EXPECTED_PLAN_LENGTHS = {
    "FP-DEMO-SINGLE-0001": 8,
    "FP-DEMO-XDOCK-0001": 13,
    "FP-DEMO-ACTIVE-0001": 13,
    "FP-DEMO-CLOSED-0001": 8,
}


def _plan_for(spec) -> list:
    """Build the phase plan a spec will produce, deriving stop roles from its legs."""
    picks_up = {leg.pickup_sequence for leg in spec.consignments}
    drops_off = {leg.delivery_sequence for leg in spec.consignments}
    return build_phase_plan([
        PlanStop(sequence=i + 1, picks_up=(i + 1) in picks_up, drops_off=(i + 1) in drops_off)
        for i in range(len(spec.precinct_names))
    ])


@pytest.mark.parametrize("pp_reference", sorted(SEEDED_WAYBILL_REFERENCES))
async def test_every_seeded_reference_resolves_in_pp(pp_reference: str):
    """The exact failure the wizard hit: a seeded reference PP cannot resolve."""
    client = MockParcelPerfectClient()

    waybill = await client.get_single_waybill(pp_reference)

    assert waybill.details.waybill == pp_reference


def test_seeded_references_match_the_seeded_fixture_group():
    """SEEDED_WAYBILLS exists to be consumed by the seeder - no orphans either way."""
    assert SEEDED_WAYBILL_REFERENCES == set(SEEDED_WAYBILLS)


def test_unassigned_pool_is_never_consumed_by_a_seeded_trip():
    """The pool's whole purpose is being free for the wizard to create a NEW trip.

    A reference used by a seeded trip is a 409 in the wizard, not a usable one, so
    an overlap here would quietly remove the only working demo path for creation.
    """
    assert not SEEDED_WAYBILL_REFERENCES & set(UNASSIGNED_WAYBILLS)


def test_unassigned_pool_resolves_in_pp():
    assert set(UNASSIGNED_WAYBILLS) <= set(MOCK_WAYBILLS)


def test_trip_references_are_unique():
    # trips.trip_reference is UNIQUE - a duplicate here fails mid-seed, after
    # earlier trips have already been written.
    references = [spec.trip_reference for spec in TRIP_SPECS]
    assert len(references) == len(set(references))


def test_each_seeded_trip_rides_one_manifest_with_a_header() -> None:
    for spec in TRIP_SPECS:
        manifests = {MOCK_WAYBILLS[leg.pp_reference].details.manifest for leg in spec.consignments}
        assert len(manifests) == 1, f"{spec.trip_reference} spans manifests {manifests}"
        assert manifests.pop() in MOCK_MANIFEST_HEADERS


def test_manifest_keys_are_unique() -> None:
    # uq_trips_pp_manifest refuses a duplicate on a live trip; the seeder writes rows
    # directly and would sail past that guard into a state the application forbids.
    keys = [_manifest_key_for(spec) for spec in TRIP_SPECS]
    assert len(keys) == len(set(keys))


def test_demo_precincts_carry_every_demo_hub_code() -> None:
    assert {p.pp_hub_code for p in DEMO_PRECINCTS} == DEMO_HUB_CODES


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_consignment_legs_stay_within_the_route(spec):
    valid = range(1, len(spec.precinct_names) + 1)
    for leg in spec.consignments:
        assert leg.pickup_sequence in valid, leg.pp_reference
        assert leg.delivery_sequence in valid, leg.pp_reference
        # A consignment travels forward along the route; equal or reversed stops
        # would produce a stop that both loads and unloads the same cargo.
        assert leg.pickup_sequence < leg.delivery_sequence, leg.pp_reference


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_plan_length_matches_expected_shape(spec):
    assert len(_plan_for(spec)) == _EXPECTED_PLAN_LENGTHS[spec.trip_reference]


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_numeric_advance_through_lies_inside_the_plan(spec):
    """An out-of-range walk silently seeds a trip stuck at a phase that never runs."""
    if not isinstance(spec.advance_through, int):
        return

    assert 0 <= spec.advance_through < len(_plan_for(spec))


def test_exactly_one_spec_walks_to_completion():
    """The closed-trip seed is load-bearing for the `closed` status filter."""
    walked_fully = [s for s in TRIP_SPECS if s.advance_through == "all"]

    assert len(walked_fully) == 1
    assert walked_fully[0].trip_reference == "FP-DEMO-CLOSED-0001"


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_trip_creation_is_resolved_on_every_seeded_trip(spec):
    """P0 left PENDING makes a seeded trip un-walkable from both ends.

    The seeder wrote every row PENDING, so the two specs with advance_through=None
    seeded a trip stuck at sequence 0 forever: the driver app derived trip_creation
    as the current phase, rendered it as "Trip Created" with an empty step recipe
    and no way forward, and _gate_and_load would have 409'd any completion the
    driver did submit ("an earlier phase in the plan is still unresolved").
    create_trip() resolves P0 inline for precisely this reason; the seeder now does
    the same.
    """
    assert TRIP_CREATION_SEQUENCE in resolved_sequences(spec, len(_plan_for(spec)))


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_unwalked_specs_resolve_trip_creation_and_nothing_else(spec):
    """The fix must not quietly hand the driver a trip that is already underway.

    FP-DEMO-SINGLE-0001 and FP-DEMO-XDOCK-0001 exist to be walked from the first
    driver step; resolving anything past P0 would skip the phase under test.
    """
    if spec.advance_through is not None:
        pytest.skip("spec walks a prefix of its plan; covered by the test below")

    assert resolved_sequences(spec, len(_plan_for(spec))) == {TRIP_CREATION_SEQUENCE}


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_advance_through_still_resolves_its_whole_prefix(spec):
    """Making P0 unconditional must not shorten or reshape an existing walk."""
    if spec.advance_through is None:
        pytest.skip("spec walks nothing; covered by the test above")

    plan_length = len(_plan_for(spec))
    expected_last = plan_length - 1 if spec.advance_through == "all" else spec.advance_through

    assert resolved_sequences(spec, plan_length) == set(range(expected_last + 1))


def _walked_event(phase_type: PhaseType, spec) -> PhaseEvent:
    event = PhaseEvent(phase_type=phase_type.value)
    _apply_walk_evidence(
        event, spec=spec, stop_sequence=2, precinct=None, loaded_at={}, delivered_at={},
    )
    return event


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_seeded_unloading_row_carries_no_seal_fields(spec):
    """The seal moved to arrival. A seeded unloading row holding one would show the
    dispatcher a second, unexplained seal reading that no live completion writes."""
    event = _walked_event(PhaseType.UNLOADING, spec)

    assert event.seal_number is None
    assert event.seal_condition is None
    assert event.seal_photo_artifact_id is None
    assert event.gate_photo_artifact_id is None


@pytest.mark.parametrize("spec", TRIP_SPECS, ids=lambda s: s.trip_reference)
def test_seeded_arrival_row_finds_the_departure_seal_intact(spec):
    arrival = _walked_event(PhaseType.ARRIVAL, spec)
    departure = _walked_event(PhaseType.DEPARTURE, spec)

    assert arrival.seal_number == departure.seal_number == spec.seal_number
    assert arrival.seal_condition == SealCondition.INTACT.value


def test_seeded_position_for_in_transit_uses_the_next_stop():
    stop_id = uuid.uuid4()
    event = PhaseEvent(
        phase_type=PhaseType.IN_TRANSIT.value,
        trip_stop_id=stop_id,
    )

    position = _position_for_event(
        event,
        stop_sequence_by_id={stop_id: 1},
        precinct_by_sequence={
            1: (Decimal("-33.9249"), Decimal("18.4241")),
            2: (Decimal("-29.0852"), Decimal("26.1596")),
        },
    )

    assert position == (Decimal("-29.0852"), Decimal("26.1596"), None)


def test_seeded_scan_evidence_stamps_scanned_out_and_in_parcels():
    parcels = [
        Parcel(barcode="A-1", status=ParcelStatus.PENDING),
        Parcel(barcode="A-2", status=ParcelStatus.PENDING),
    ]
    scanned_out_at = datetime(2026, 7, 30, 6, 40, tzinfo=UTC)
    scanned_in_at = datetime(2026, 7, 30, 10, 40, tzinfo=UTC)

    _apply_seed_scan_evidence(
        parcels,
        scanned_out_at=scanned_out_at,
        scanned_in_at=scanned_in_at,
    )

    assert all(parcel.pp_scan_out_at == scanned_out_at for parcel in parcels)
    assert all(parcel.pp_scan_in_at == scanned_in_at for parcel in parcels)
    assert all(parcel.status == ParcelStatus.SCANNED_IN for parcel in parcels)


def test_seeded_completed_phase_carries_phone_and_horse_position():
    event = PhaseEvent(
        phase_type=PhaseType.ACTIVATION.value,
        completed_at=datetime(2026, 7, 30, 6, 20, tzinfo=UTC),
    )

    _apply_seed_position_evidence(
        event,
        position=(Decimal("-33.9249"), Decimal("18.4241"), True),
    )

    assert event.driver_phone_lat == Decimal("-33.9249")
    assert event.driver_phone_lng == Decimal("18.4241")
    assert event.driver_captured_at == event.completed_at
    assert event.horse_gps_lat == Decimal("-33.9249")
    assert event.horse_gps_lng == Decimal("18.4241")
    assert event.pulsit_geofence_confirmed is True


def test_seeded_completed_phase_carries_trailer_position():
    event = PhaseEvent(
        id=uuid.uuid4(),
        phase_type=PhaseType.ACTIVATION.value,
        completed_at=datetime(2026, 7, 30, 6, 20, tzinfo=UTC),
    )
    trailer_id = uuid.uuid4()

    snapshot = _trailer_snapshot_for_event(
        event,
        trailer_id=trailer_id,
        pulsit_device_id="PLT-TRAILER-001",
        position=(Decimal("-33.9249"), Decimal("18.4241"), True),
    )

    assert snapshot is not None
    assert snapshot.phase_event_id == event.id
    assert snapshot.trailer_id == trailer_id
    assert snapshot.pulsit_device_id == "PLT-TRAILER-001"
    assert snapshot.lat == Decimal("-33.9249")
    assert snapshot.lng == Decimal("18.4241")
    assert snapshot.geofence_confirmed is True
