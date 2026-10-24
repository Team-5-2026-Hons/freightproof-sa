# Phase model reference

**Branch verification:** `Ciaran`, 2026-09-26. This describes the checked-out source,
not necessarily `dev`, a deployed environment, or previously created trips.

## Current branch model

`backend/app/orchestration/phase_plan.py` generates a committed phase plan at trip
creation. `phase_events` is the ledger; `current_phase` and `current_stop` are derived
caches, not sequencing authority. Transitions are validated against the plan, not
`trip.status`.

The current enum has eight phase types: `trip_creation`, `activation`, `loading`,
`departure`, `in_transit`, `arrival`, `unloading`, and `confirmation`.

Plan length is data, not the number of enum values. It depends on the ordered stops and
whether each stop picks up or drops off consignments. Eight rows is the common two-stop
loaded shape; thirteen is a three-stop cross-dock with the corresponding pickup/drop-off
phases. Other valid trip shapes generate different counts. Loading and unloading may
recur, and arrival applies at later stops.

`in_transit` is a planned phase with no driver step recipe; it is not described here as
an automatic completion. The exact completion path and branch handoff remain in the
[arrival and live-journey note](design-notes/2026-09-23-arrival-phase-and-live-journey.md).

## Evidence boundary

The repository models per-phase anchor status, including failed and pending states. An
anchor records a submitted payload; it does not independently prove every real-world
observation. Provider and deployment verification require dated evidence.

## Branch and deployment boundary

Arrival and expanded anchoring are present in this checkout. Do not claim they are
merged to `dev`, migrated, or deployed without checking the relevant target. Existing
trips may have been created under an earlier plan and need the compatibility/reset
decision recorded by active lifecycle documentation.

## History

Earlier versions described the retired seven-type model, seven/eleven-row examples, and
contradictory automatic-versus-driver-submitted transit explanations. They are historical,
not instructions. The exact pre-cleanup explanation is preserved in the
[phase-model archive record](archive/phase-model-explained-pre-cleanup.md).

## Related references

- [Arrival phase and live journey](design-notes/2026-09-23-arrival-phase-and-live-journey.md)
- [Known issues and deferred work](known-issues.md)
- [Documentation archive](archive/INDEX.md)
