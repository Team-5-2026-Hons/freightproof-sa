"""Unit tests for app.orchestration.phase_plan.build_phase_plan().

Asserts the plan against the frozen reference implementation, makePhasePlan(),
in frontend/shared/lib/mocks/phase-trips.ts. Pure logic, no DB, no HTTP.

Run: pytest tests/unit/test_phase_plan.py -v
"""

from app.db.models.enums import PhaseType
from app.orchestration.phase_plan import PlanStop, PlannedPhase, build_phase_plan


def _as_tuples(plan: list[PlannedPhase]) -> list[tuple[int, PhaseType, int | None]]:
    return [(p.sequence_number, p.phase_type, p.stop_sequence) for p in plan]


def test_single_leg_plan_has_eight_rows_in_order():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2])

    assert _as_tuples(plan) == [
        (0, PhaseType.TRIP_CREATION, None),
        (1, PhaseType.ACTIVATION, 1),
        (2, PhaseType.LOADING, 1),
        (3, PhaseType.DEPARTURE, 1),
        (4, PhaseType.IN_TRANSIT, 1),
        (5, PhaseType.ARRIVAL, 2),
        (6, PhaseType.UNLOADING, 2),
        (7, PhaseType.CONFIRMATION, 2),
    ]


def test_cross_dock_plan_has_thirteen_rows_in_order():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=True, drops_off=True)
    stop3 = PlanStop(sequence=3, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2, stop3])

    assert _as_tuples(plan) == [
        (0, PhaseType.TRIP_CREATION, None),
        (1, PhaseType.ACTIVATION, 1),
        (2, PhaseType.LOADING, 1),
        (3, PhaseType.DEPARTURE, 1),
        (4, PhaseType.IN_TRANSIT, 1),
        (5, PhaseType.ARRIVAL, 2),
        (6, PhaseType.UNLOADING, 2),
        (7, PhaseType.LOADING, 2),
        (8, PhaseType.DEPARTURE, 2),
        (9, PhaseType.IN_TRANSIT, 2),
        (10, PhaseType.ARRIVAL, 3),
        (11, PhaseType.UNLOADING, 3),
        (12, PhaseType.CONFIRMATION, 3),
    ]


def test_only_trip_creation_has_no_stop():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=True, drops_off=True)
    stop3 = PlanStop(sequence=3, picks_up=False, drops_off=True)

    single_leg_plan = build_phase_plan([
        PlanStop(sequence=1, picks_up=True, drops_off=False),
        PlanStop(sequence=2, picks_up=False, drops_off=True),
    ])
    cross_dock_plan = build_phase_plan([stop1, stop2, stop3])

    for plan in (single_leg_plan, cross_dock_plan):
        null_stop_rows = [p for p in plan if p.stop_sequence is None]

        assert len(null_stop_rows) == 1
        assert null_stop_rows[0].phase_type == PhaseType.TRIP_CREATION


def test_in_transit_anchors_to_departure_stop():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=True, drops_off=True)
    stop3 = PlanStop(sequence=3, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2, stop3])

    in_transit_rows = [p for p in plan if p.phase_type == PhaseType.IN_TRANSIT]

    # Departs stop 1 -> anchored to 1 (not 2, the stop it arrives at).
    # Departs stop 2 -> anchored to 2 (not 3, the stop it arrives at).
    assert [row.stop_sequence for row in in_transit_rows] == [1, 2]


def test_sequence_number_is_row_index():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=True, drops_off=True)
    stop3 = PlanStop(sequence=3, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2, stop3])

    assert [p.sequence_number for p in plan] == list(range(len(plan)))
    # The plan is longer than the enum's cardinality -- sequence_number
    # is a row index, not bounded by the number of distinct PhaseType values.
    assert len(plan) > len(PhaseType)


def test_empty_leg_plan_still_closes_custody():
    stop1 = PlanStop(sequence=1, picks_up=False, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=False, drops_off=False)

    plan = build_phase_plan([stop1, stop2])

    assert _as_tuples(plan) == [
        (0, PhaseType.TRIP_CREATION, None),
        (1, PhaseType.ACTIVATION, 1),
        (2, PhaseType.DEPARTURE, 1),
        (3, PhaseType.IN_TRANSIT, 1),
        (4, PhaseType.ARRIVAL, 2),
        (5, PhaseType.UNLOADING, 2),
        (6, PhaseType.CONFIRMATION, 2),
    ]


def test_pickup_only_stop_still_gets_arrival_before_loading():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=True, drops_off=False)
    stop3 = PlanStop(sequence=3, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2, stop3])

    stop2_types = [p.phase_type for p in plan if p.stop_sequence == 2]
    assert stop2_types == [
        PhaseType.ARRIVAL, PhaseType.LOADING, PhaseType.DEPARTURE, PhaseType.IN_TRANSIT,
    ]


def test_every_in_transit_is_followed_by_arrival_at_the_next_stop():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=True, drops_off=True)
    stop3 = PlanStop(sequence=3, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2, stop3])

    for i, row in enumerate(plan):
        if row.phase_type == PhaseType.IN_TRANSIT:
            following = plan[i + 1]
            assert following.phase_type == PhaseType.ARRIVAL
            # Arrival belongs to the stop being arrived at, not the one departed from.
            assert following.stop_sequence == row.stop_sequence + 1


def test_first_stop_has_no_arrival():
    stop1 = PlanStop(sequence=1, picks_up=True, drops_off=False)
    stop2 = PlanStop(sequence=2, picks_up=False, drops_off=True)

    plan = build_phase_plan([stop1, stop2])

    arrival_stops = [p.stop_sequence for p in plan if p.phase_type == PhaseType.ARRIVAL]
    assert arrival_stops == [2]
