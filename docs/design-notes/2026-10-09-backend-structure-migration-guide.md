# Backend structure: teammate migration guide

**Updated:** 2026-10-09. **Status:** instructions for adopting the package moves; no teammate's
migration or wrapper removal is asserted by this document.

The [structure audit](2026-10-06-backend-structure-tech-debt-audit.md) owns the plan. Its §6.1 tracks
branch acknowledgements and eventual wrapper removal. Its §5.7 lists proposed future grouping;
those proposed paths are not available yet. The paths below describe the implementation now.

## What changed

Large backend domains now live in packages under `app/orchestration/`. The 24 old orchestration
modules remain as compatibility wrappers: they re-export existing functions so older branches can
still import them. New functions belong in the implementation modules, never in wrappers.

`app/integrations/parcel_perfect/` is also a package; its `__init__.py` supplies compatibility exports.
Dev tooling moved to `app/dev/` without wrappers. The database/API contract is not renamed merely
because Python modules moved. Separate functional fixes must still be reviewed when integrating `dev`.

## Behaviour changes in the same PR

These are not module moves. Check them against your branch when you integrate `dev`:

- **Receiver consent** (`POST /api/v1/handover/{raw_token}/consent`): `consented` is now a required
  boolean. `false` records a refusal (no consent timestamp or wording hash, tier `typed_only`); a body
  without it gets a 422. Any client calling this route must send it explicitly.
- **Receiver verification resolution:** the receiver's name and ID number travel in the JSON body,
  not in URL query parameters, so they cannot reach access logs.
- **Journey lock v2:** new trips anchor a v2 payload that also commits to the ordered stops
  (sequence, precinct, slot time). Verification reads the version from the anchored receipt, so trips
  anchored as v1 still verify. Do not change either payload format; anything that reconstructs a
  journey hash should go through `verify_subject`.
- **Phase writes lock the trip row** (`FOR NO KEY UPDATE`, trip before phase event). New code that
  writes a phase or changes trip status must take locks in that same order, or it can deadlock.

## Every developer's migration sequence

1. **Identify your branches and affected work.** Record every maintained branch that touches the
   backend, tests or supporting scripts. Tell the integration coordinator which old modules you
   import or modify. Do not claim “unaffected” based only on which UI you own.
2. **Integrate the restructure from `dev` once it has landed**, using the team's usual human-run Git
   workflow. Preserve uncommitted work first. The presence of a wrapper may make imports succeed,
   but it does not establish that your feature changes reached the implementation.
3. **Move pending implementation edits to their new homes.** If your branch changed a function in
   `phase_service.py`, compare that change with its new owning module and apply the intended behaviour
   there. Keep the old file as a re-export wrapper. Do not resolve conflicts by replacing the wrapper
   with your branch's old monolithic service, or by discarding your feature changes wholesale.
4. **Migrate imports by symbol**, using the table below and the import statements inside the wrapper.
   Several old files now map to several modules, so a global filename replacement is insufficient.
   Update application code, ordinary test imports, scripts, fixtures and dynamic import strings.
5. **Retarget patches to the lookup site**, as explained below. Run the affected tests immediately;
   do not assume an import-compatible wrapper is patch-compatible.
6. **Verify and smoke-test your feature.** Use the commands below and the relevant frontend's checks.
   Inspect any API/snapshot changes; do not regenerate snapshots merely to hide an unexpected failure.
7. **Record sign-off in audit §6.1.** Supply branches/revisions, paths migrated, test results and
   remaining blockers. A developer with no consumers records that explicitly. Keep wrappers until
   the coordinator opens a removal PR meeting that checklist.

## Current old-path → implementation map

Unless stated otherwise, both columns are relative to `app.orchestration`; append the module path
to that prefix in Python imports. The old wrapper's individual imports are authoritative for symbols
not named here. Do not import a package root as a replacement shortcut; orchestration package
`__init__.py` files stay empty.

| Old module | Current implementation / responsibility |
|---|---|
| `phase_service` | `phases.service` (`complete_phase`); `phases.advance_*` (individual handshakes); `phases.override`; `phases.queries`; `phases.payloads`; `phases.anchor_*` and other leaves. Resolve each symbol from the wrapper |
| `phase_gate` | `phases.blocking` |
| `phase_plan` | `phases.plan` |
| `trip_service` | `trips.creation` (create/persist); `trips.administration` (cancel); `trips.queries` (driver reads) |
| `exception_service` | `exceptions.creation` (raise); `exceptions.review` (claim/release/review); `exceptions.queries` (queue/history/detail) |
| `action_location_service` | `evidence.action_location` |
| `artifact_service` | `evidence.artifacts` |
| `checkpoint_service` | `evidence.checkpoints` |
| `corroboration_service` | `evidence.corroboration` |
| `geofence_service` | `evidence.geofence` |
| `location_service` | `evidence.location` |
| `proximity_service` | `evidence.proximity` |
| `road_check_service` | `evidence.road_check` |
| `driver_service` | `fleet.drivers` |
| `vehicle_service` | `fleet.vehicles` |
| `precinct_service` | `fleet.precincts` |
| `handover_service` | `handover.capability` |
| `receiver_verification_service` | `handover.receiver_verification` |
| `consignment_service` | `consignments.sync` |
| `manifest_service` | `consignments.manifest_reads` |
| `pp_lookup_service` | `consignments.waybill_lookup` |
| `pp_manifest_service` | `consignments.manifest_import` |
| `pp_manifest` | `consignments.manifest_snapshot` |
| `scan_service` | `consignments.scans` |

Other paths:

- `app.integrations.parcel_perfect.get_pp_client` → import from
  `app.integrations.parcel_perfect.factory`; `ParcelPerfectPort` from `.port`, response types from
  `.models`, live client from `.client`, mock client from `.mock`, errors from `.errors`, and time
  parsing from `.timestamps`. Read the package facade for fixture-symbol homes.
- The former `app.integrations.parcel_perfect_port` path has moved to
  `app.integrations.parcel_perfect.port`; it is not one of the retained wrappers.
- Dev endpoints now live in `app.dev.endpoints.{triggers,pulsit,tracker}`, dev services in
  `app.dev.services.{rig,truck}`, and dev schemas in `app.dev.schemas`. Old dev paths have no
  compatibility wrapper. Production modules must not import this top-layer package.
- `analytics_service`, `fleet_analytics_service`, `verification_service`, `receipt_service`,
  `resource_service`, `review_identity`, `review_policy` and `integrity` still contain real code at
  their existing paths. Do not target the audit's proposed future folders before those moves land.

Example of an ordinary import migration:

```python
# Old, temporarily supported:
from app.orchestration.trip_service import create_trip, cancel_trip

# Current owners:
from app.orchestration.trips.creation import create_trip
from app.orchestration.trips.administration import cancel_trip
```

## Test patches: change where the name is looked up

Suppose `advance_arrival.py` imports `_gate_and_load` from `phases.gate`. Patching the facade or
even the original defining module does not replace that already-imported local name:

```python
# Wrong after the move:
monkeypatch.setattr("app.orchestration.phase_service._gate_and_load", fake_gate)

# Correct for a test exercising advance_arrival:
monkeypatch.setattr("app.orchestration.phases.advance_arrival._gate_and_load", fake_gate)
```

A shared fixture driving several `advance_*` modules may need one patch per lookup site. Inspect
the caller's import form before choosing the target. This applies to `patch`, `patch.object`,
`patch.multiple`, `patch.dict`, pytest-mock and string constants used by patch helpers.

B8 checks known facade patch forms; it does not prove every ordinary or dynamically constructed
import has migrated. Run a reference search too. For example, from the repository root:

```sh
rg -n 'phase_service|trip_service|exception_service' backend/app backend/tests backend/scripts
# without ripgrep:
grep -rnE 'phase_service|trip_service|exception_service' backend/app backend/tests backend/scripts
```

Repeat for every old module relevant to your branch, including module aliases and dynamic imports.
Classify hits: test filenames, historical comments, wrapper definitions and guardrail inventories
are not runtime consumers. A plain `from ... import ...` in a test is a consumer even if B8 passes.

## Validation and sign-off

Run from `backend/` in the configured development environment:

```sh
.venv/bin/ruff check .
.venv/bin/python scripts/check_structure.py
.venv/bin/lint-imports
.venv/bin/mypy .
.venv/bin/python -m pytest -q -m "not slow"
.venv/bin/python -m pytest -q -m slow tests/baseline/test_b7_import_cycles.py
```

Use a configured **local disposable test database**, never the shared application database.
The suite creates and drops test tables: two runs must not share the same test database concurrently.
Record skips and missing prerequisites as well as passes. For UI changes, run that app's lint,
types, tests and build, and exercise the affected workflow against the integrated backend.

B1/B2 snapshots, B3/B4 hashes/legacy verification and B6 task names must stay unchanged for a pure
module move. If your feature intentionally changes a contract, explain and review that change
separately. Do not relax import/structure checks or rename stored hash keys to resolve a move.

Each owner records:

```text
Developer:
Maintained branches and revisions:
Integrated restructure/dev revision:
Old paths migrated (or no affected consumers, with search scope):
Pending feature edits moved to implementation modules:
Patch targets checked:
Checks and UI smoke results, including skips:
Remaining blockers / wrappers still needed:
PR or commit evidence:
```

Tim should also check the audit-pack and subject-visibility changes named in audit §8, and review
snapshot/task-name differences introduced by his feature. Chiko and Tom use the same checklist for
their actual branches; this guide does not assume their current ownership or mark either unaffected.
Ciaran/the integrating developer collects the sign-offs, records the landing revision and coordinates
retirement. Only the designated developer integrating to `dev` refreshes the shared Graphify output.

## Wrapper removal is a separate checkpoint

The retirement inventory and completion gates live in audit §6.1, not in private chat. Revisit them
after each affected branch integrates. Retire eligible wrappers package by package in dedicated PRs;
keep anything still used by a maintained branch. Additional grouping moves must update this guide
and that inventory in the same change. Retiring Parcel Perfect exports must preserve the package
and its fixture initialization behaviour, not delete its implementation directory.

## Suggested team handoff message

> The backend package restructure retains old-path wrappers temporarily. Please integrate the new
> dev revision once it lands, move pending service edits into their implementation modules, migrate
> imports and test patches using this guide, and record your branch/check evidence in audit §6.1.
> Do not add logic to wrappers or remove wrappers independently. We will remove them in dedicated
> cleanup PRs once the relevant branches have migrated. Proposed further grouping is listed separately
> in audit §5.7; use the current paths in this guide until those moves land.

This text is a draft to share; adding it here does not send a message to any teammate.
