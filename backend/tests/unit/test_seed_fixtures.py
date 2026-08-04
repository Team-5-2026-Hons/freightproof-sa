"""Drift guard between scripts/seed_trips.py and the PP mock fixture library.

These two drifted apart once already: the seeder invented references
(MOCKWB0001-0007) that MOCK_WAYBILLS had never contained, so every seeded trip
looked fine in the database while the dispatcher wizard's fail-closed PP lookup
returned 404 for the platform's own demo data. Nothing failed - there was no test
that could fail - until someone typed a seeded waybill into the wizard.

This file is that test. It imports the seeder's spec rather than duplicating it,
so a reference added to one side and not the other fails the build.
"""

import pytest

from app.integrations.parcel_perfect import (
    MOCK_WAYBILLS,
    SEEDED_WAYBILLS,
    UNASSIGNED_WAYBILLS,
    MockParcelPerfectClient,
)
from app.orchestration.phase_plan import PlanStop, build_phase_plan
from scripts.seed_trips import (
    SEEDED_WAYBILL_REFERENCES,
    TRIP_CREATION_SEQUENCE,
    TRIP_SPECS,
    resolved_sequences,
)

# Expected plan length per seeded trip, keyed by trip_reference. Stated here rather
# than computed so a change to build_phase_plan that silently reshapes the demo
# trips has to be acknowledged: 2 stops -> 7 rows, 3-stop cross-dock -> 11.
_EXPECTED_PLAN_LENGTHS = {
    "FP-DEMO-SINGLE-0001": 7,
    "FP-DEMO-XDOCK-0001": 11,
    "FP-DEMO-ACTIVE-0001": 11,
    "FP-DEMO-CLOSED-0001": 7,
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


def test_order_numbers_are_unique():
    # create_trip rejects a duplicate active order_number per operator org; the
    # seeder writes rows directly and would sail past that guard into a state the
    # application itself forbids.
    order_numbers = [spec.order_number for spec in TRIP_SPECS]
    assert len(order_numbers) == len(set(order_numbers))


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
