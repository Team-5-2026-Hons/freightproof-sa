"""Phase-plan generation — parent plan §2.2.

Pure and DB-free on purpose: the rule is the refactor's central claim ("length is
data") and it is easier to defend, and to test, as a function of the route than as
a side effect of trip creation. Stage 2.1 calls this from trip_service.create_trip.

This is a port of makePhasePlan() in frontend/shared/lib/mocks/phase-trips.ts,
which is the frozen contract's executable statement of the same rule. The two must
emit identical plans; the backend is authoritative if they ever drift.
"""

from dataclasses import dataclass

from app.db.models.enums import PhaseType

# D7 — the phases that carry a Hedera receipt. P1/P2/P4/P5 are feeders.
ANCHORED_PHASES: frozenset[PhaseType] = frozenset({
    PhaseType.TRIP_CREATION,
    PhaseType.DEPARTURE,
    PhaseType.CONFIRMATION,
})


@dataclass(frozen=True)
class PlanStop:
    """One stop's routing role — all the generator needs to decide what happens there.

    Derived from the trip's consignments: `picks_up` if any consignment's
    pickup_stop_id is this stop, `drops_off` if any consignment's delivery_stop_id is.
    A TripStop has no inherent origin/destination role (FP-112).
    """

    sequence: int
    picks_up: bool
    drops_off: bool


@dataclass(frozen=True)
class PlannedPhase:
    sequence_number: int
    phase_type: PhaseType
    # None only for trip_creation (D3).
    stop_sequence: int | None


def build_phase_plan(stops: list[PlanStop]) -> list[PlannedPhase]:
    """Emit a trip's committed phase plan, in order, from its stops.

    The rule: `trip_creation` once with no stop; then for each stop in sequence,
    `activation` (first stop only) or `unloading` (if anything delivers here); then
    `loading` (if anything collects here); then `departure` + `in_transit` unless it
    is the final stop, where `confirmation` is emitted instead.

    `in_transit` anchors to the stop it DEPARTS FROM, never the one it arrives at
    (D3) — which is what keeps trip_creation the only NULL-stop row and lets one
    partial unique index close the duplicate-P0 hole.

    2 stops -> 7 rows. 3-stop cross-dock -> 11 rows. The single-leg trip is the
    degenerate case of the multi-stop plan: one code path, forever.
    """
    if not stops:
        raise ValueError("a trip needs at least one stop to generate a phase plan")

    plan: list[PlannedPhase] = []

    def emit(phase_type: PhaseType, stop: PlanStop | None) -> None:
        plan.append(PlannedPhase(
            sequence_number=len(plan),
            phase_type=phase_type,
            stop_sequence=None if stop is None else stop.sequence,
        ))

    emit(PhaseType.TRIP_CREATION, None)

    last_index = len(stops) - 1
    for i, stop in enumerate(stops):
        if i == 0:
            emit(PhaseType.ACTIVATION, stop)
        elif stop.drops_off:
            emit(PhaseType.UNLOADING, stop)

        if stop.picks_up:
            emit(PhaseType.LOADING, stop)

        if i < last_index:
            emit(PhaseType.DEPARTURE, stop)
            emit(PhaseType.IN_TRANSIT, stop)
        else:
            # The final stop always closes the custody chain, even on an empty leg
            # where nothing is dropped — otherwise a repositioning run would end
            # with no unloading row and the ledger would not be a complete story.
            if i != 0 and not stop.drops_off:
                emit(PhaseType.UNLOADING, stop)
            emit(PhaseType.CONFIRMATION, stop)

    return plan
