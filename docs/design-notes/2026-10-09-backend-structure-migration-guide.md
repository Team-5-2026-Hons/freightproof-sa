# Backend structure: teammate migration guide

**Updated:** 2026-10-12. **Status:** the compatibility wrappers are **retired** (audit §6.1 removal
record). This guide is now the old → new reference for adopting the package moves; it asserts no
teammate's migration.

The [structure audit](2026-10-06-backend-structure-tech-debt-audit.md) owns the plan. Its §6.1 tracks
branch acknowledgements and the wrapper removal record. Its §5.7 lists proposed future grouping;
those proposed paths are not available yet. The paths below describe the implementation now.

## What changed

Large backend domains now live in packages under `app/orchestration/`. The 31 old flat modules were
compatibility wrappers for a while; **they no longer exist**. An import of an old path fails with
`ModuleNotFoundError`, and B8's `RETIRED_MODULES` test fails on any `.py` in `app/`, `tests/` or `scripts/`
that names one. Only `integrity` is still a real flat module. Migrate each import to the module that
defines the name, using the map below.

`app/integrations/parcel_perfect/` is also a package; its `__init__.py` still supplies compatibility exports (it was not retired).
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
   workflow. Preserve uncommitted work first. Expect conflicts or `ModuleNotFoundError` where your branch
   still touches an old flat module: the file no longer exists on `dev`.
3. **Move pending implementation edits to their new homes.** If your branch changed a function in
   `phase_service.py`, compare that change with its new owning module and apply the intended behaviour
   there. Do not resolve a conflict by restoring the old file or your branch's old monolithic service, and
   do not discard your feature changes wholesale.
4. **Migrate imports by symbol**, using the table below. Where an old file maps to several modules, the
   old wrapper's import lines named the owner of each symbol; read them from git with
   `git show <commit before the retirement commit>:backend/app/orchestration/<old>.py`, or grep for
   the definition. Several old files map to several modules, so a global filename replacement is insufficient.
   Update application code, ordinary test imports, scripts, fixtures and dynamic import strings.
5. **Retarget patches to the lookup site**, as explained below. Run the affected tests immediately;
   patching an old path no longer works at all.
6. **Verify and smoke-test your feature.** Use the commands below and the relevant frontend's checks.
   Inspect any API/snapshot changes; do not regenerate snapshots merely to hide an unexpected failure.
7. **Record sign-off in audit §6.1.** Supply branches/revisions, paths migrated, test results and
   remaining blockers. A developer with no consumers records that explicitly.

## Old-path → implementation map (retired, no wrapper)

Unless stated otherwise, both columns are relative to `app.orchestration`; append the module path
to that prefix in Python imports. The retired wrapper's individual imports (see step 4) are authoritative for symbols
not named here. Do not import a package root as a replacement shortcut; orchestration package
`__init__.py` files stay empty.

| Old module | Current implementation / responsibility |
|---|---|
| `phase_service` | `phases.service` (`complete_phase`); `phases.advance_*` (individual handshakes); `phases.override`; `phases.queries`; `phases.payloads`; `phases.anchor_*` and other leaves. Resolve each symbol from the retired wrapper's imports or by grep |
| `phase_gate` | `phases.blocking` |
| `phase_plan` | `phases.plan` |
| `trip_service` | `trips.creation` (create/persist); `trips.administration` (cancel); `trips.queries` (driver reads) |
| `resource_service` | `trips.detail` (`get_trip_detail`); `trips.listing` (`list_trips`, `list_trip_history`) |
| `exception_service` | `exceptions.creation` (raise); `exceptions.review` (claim/release/review); `exceptions.queries` (queue/history/detail) |
| `review_identity` | `exceptions.review_identity` (`user_names`, `name_of`, `with_reviewer_names`) |
| `review_policy` | `exceptions.review_policy` (`initial_review_status`, `dispatcher_authored_review`, `AuthoredReviewFields`) |
| `verification_service` | `verification.service` (`VerifyOutcome`, `verify_subject`, `verify_visible_subject`); `verification.phase_payloads` (`reconstruct_pending_phase_payload`, `_hash_payload`); `verification.fleet_events` (`_reconstruct_precinct_event_payload`) |
| `receipt_service` | `verification.receipts` (`lookup_receipts`, `list_receipts_for_subject`) |
| `analytics_service` | `analytics.metrics` (dispatcher analytics screen). Not `app.analytics`: that package holds the query and calculation code and did not move |
| `fleet_analytics_service` | `analytics.fleet` (fleet-wide analytics page) |
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
| `audit_pack_analysis` | `audit_packs.analysis`: moved without wrapper |
| `incident_declaration_service` | `audit_packs.incident_declarations`: moved without wrapper |
| `audit_pack_builder` | `audit_packs.builder`: moved without wrapper |
| `audit_pack_service` | `audit_packs.lifecycle`: moved without wrapper |
| `audit_pack_access` | `audit_packs.access`: moved without wrapper |

Other paths:

- The five audit-pack modules (last five rows of the table) have **no compatibility wrapper**, like
  `app.dev`: the old paths no longer exist, so a branch that still imports them fails with
  `ModuleNotFoundError` until it migrates. Module names changed (the `audit_pack_` prefix and the
  `_service` suffix are gone); function, class and constant names did not. Patch targets keep the module
  that looks the name up, now `app.orchestration.audit_packs.lifecycle` (`upload_audit_pack_pdf`,
  `download_audit_pack_pdf`, `anchor_subject`) or `app.orchestration.audit_packs.access`
  (`download_audit_pack_pdf`, `download_evidence_file`, `HederaService`). Logger names follow
  `__name__`, so they changed with the module path.
- `app.integrations.parcel_perfect.get_pp_client` (the package `__init__` still re-exports it; new code imports from `.factory`) → import from
  `app.integrations.parcel_perfect.factory`; `ParcelPerfectPort` from `.port`, response types from
  `.models`, live client from `.client`, mock client from `.mock`, errors from `.errors`, and time
  parsing from `.timestamps`. Read the package facade for fixture-symbol homes.
- The former `app.integrations.parcel_perfect_port` path has moved to
  `app.integrations.parcel_perfect.port`; it never had a wrapper.
- Dev endpoints now live in `app.dev.endpoints.{triggers,pulsit,tracker}`, dev services in
  `app.dev.services.{rig,truck}`, and dev schemas in `app.dev.schemas`. Old dev paths have no
  compatibility wrapper. Production modules must not import this top-layer package.
- Handover route database work (the receiver QR routes' queries and sequencing) lives in
  `app.orchestration.handover.service`, the top tier of `handover/`. It is new code, not a move, so
  there is no wrapper and no old path. `endpoints/handover.py` keeps `commit` and `rollback`.
- Patch targets for verification: `HederaService` and `assert_subject_visible` and `verify_subject` are looked
  up in `app.orchestration.verification.service`; `hash_stored_evidence_file` in
  `app.orchestration.verification.phase_payloads`; `lookup_receipts` and `list_receipts_for_subject` in
  `app.orchestration.verification.receipts`. Patching a retired path fails with `ModuleNotFoundError` (and B8 flags the string). A branch whose tests still patch
  `app.orchestration.verification_service.*` must retarget them when it integrates.
- `integrity` still contains real code at its existing path.

Example of an ordinary import migration:

```python
# Old, retired (ModuleNotFoundError):
from app.orchestration.trip_service import create_trip, cancel_trip

# Current owners:
from app.orchestration.trips.creation import create_trip
from app.orchestration.trips.administration import cancel_trip
```

## Test patches: change where the name is looked up

Suppose `advance_arrival.py` imports `_gate_and_load` from `phases.gate`. Patching the (now retired) wrapper or
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

B8 checks known patch forms through the `parcel_perfect` package facade, and its `RETIRED_MODULES` tests fail on any
import or string that names a retired module; neither can see an import built at run time. Run a reference search too. For example, from the repository root:

```sh
rg -n 'phase_service|trip_service|exception_service' backend/app backend/tests backend/scripts
# without ripgrep:
grep -rnE 'phase_service|trip_service|exception_service' backend/app backend/tests backend/scripts
```

Repeat for every old module relevant to your branch, including module aliases and dynamic imports.
Classify hits: test filenames and historical comments are not runtime consumers. A plain
`from ... import ...` of a retired path is a consumer and B8 fails on it.

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
Remaining blockers:
PR or commit evidence:
```

Tim should also check the audit-pack and subject-visibility changes named in audit §8, and review
snapshot/task-name differences introduced by his feature. Chiko and Tom use the same checklist for
their actual branches; this guide does not assume their current ownership or mark either unaffected.
Ciaran/the integrating developer collects the sign-offs, records the landing revision and coordinates
retirement. Only the designated developer integrating to `dev` refreshes the shared Graphify output.

## Wrapper removal: done (stage 7, 2026-10-12)

The 31 `orchestration/` wrappers were deleted; the evidence, branch revisions and the guard that replaced
them are in the audit §6.1 removal record. Only the `integrations/parcel_perfect/__init__.py` exports remain
as a compatibility surface. Retiring those must preserve the package and its fixture initialization
behaviour, not delete its implementation directory. Any further move must update this map and add the
old path to `RETIRED_MODULES` in the same change.

## Suggested team handoff message

> The backend package restructure is on `dev` and the old flat `app/orchestration/*_service.py` modules
> (and `phase_gate`, `phase_plan`, `pp_manifest`, `review_*`) no longer exist. Please integrate the new
> dev revision, move pending service edits into their implementation modules, migrate imports and test
> patches using this guide's map, and record your branch/check evidence in audit §6.1. A stale branch
> that still imports an old path fails with `ModuleNotFoundError`; `codex/submission-docs-cleanup` has one
> such import (audit §6.1).

This text is a draft to share; adding it here does not send a message to any teammate.
