# FP-299 — Pre-commit and dev compatibility review

Date: 21 October 2026. Review of the pending FP-299 implementation on `Chiko`.

**Historical review:** the user subsequently authorized a local feature commit and dev
merge. The blockers below are the pre-fix findings. See
[integration fixes and verification](fp-299-integration-fixes.md) for the current state.

The Jira outcome was checked against [FP-299](https://inf4027team5.atlassian.net/browse/FP-299):
a small repeatable load test on a non-shared environment, with latency/error/pool evidence
showing bounded failure and recovery. The report correctly keeps deployment calibration
open: the default 10/20/30-second budgets are bounded but are not a fast user-facing SLA.

## Verdict

**FP-299's behaviour is verified on the current feature tree and in combination with
`dev@efc26426`; no feature-introduced runtime regression or content merge conflict was
found. The combined branch is not green-CI/merge-ready.** Three checks fail in upstream
dev code: mypy, the OpenAPI snapshot, and the structure ratchet (details below).

The new recovery test also showed sensitivity to competing host workloads with its
500 ms smoke pool-wait budget. It passed unchanged in isolation and in the final
sequential combined suite; the earlier failures are retained and must not be presented
as passing runs. This supports a feature commit with explicit caveats, not an
unconditional claim that every future CI host or later dev revision will pass.

## Source and evidence

- Local `HEAD`: `b869bdbb7960c084116d5f2159f8d00205411f2d`.
- Latest fetched `origin/dev`: `efc2642629fa1e29c76074638860625746868d75`.
  The first compatibility run used its parent, `51d35bc2bfeeea4652702c359e1e152577229020`.
- Current backend Python digest, independently recalculated with LF normalization:
  `f56105b283d55383a0116e292b3e46a21e7a8f94961340ca47dee872014556ac`.
- Final combined backend Python digest:
  `e2d44ee67e5287a4ca669eb3032025615db9d457583b9eee7f796e0fa3635e4a`.
  Both final review artifacts match this snapshot, rather than the feature-only tree.
- Both retained [smoke](fp-299-results/smoke.json) and
  [default-budget](fp-299-results/evidence.json) artifacts match the current feature-tree
  digest (`f56105b2…`), not the combined snapshot's digest.
  Independent recounting of raw samples, outcome categories, percentiles, envelopes,
  recovery writes, pool release and task settlement agrees with both reports:
  **39 passing cycles, 1,782 load attempts, 507 successful recovery requests,
  39 committed recovery writes and 40 warm-ups per profile**.
- The retained default-budget run's maximum recovery-read completion time is **1.6357 s**.
  Its results were audited rather than re-recorded during this review.

## Merge compatibility

**No content conflicts were found against the fetched dev revision**, including every
pending tracked change and untracked FP-299 implementation file.

This history has two best common ancestors:

```text
a2afc1a53be95ea197e13f699119c30e7004e0f0
e524b8c1e882b709b8f545750a7c85a029cbbdcd
```

Their common ancestor is `d16c928754c716141de5a4c1dc3464e10673af2e`.
Combining both ancestors with file-level three-way comparisons produces a clean virtual
base whose normalized contents exactly match local `HEAD`. Comparing the current working
tree and `origin/dev` against that virtual base gives no conflicting or overlapping
content changes. An initial comparison using only the first common ancestor produced
seven apparent conflicts; that result was invalidated by the complete ancestry check.

A disposable source snapshot combines current FP-299 with the incoming backend and
shared frontend contracts. Its contents were checked against the corrected comparison;
no manual conflict resolutions are required. Repository branches, index and history
were not changed. This verdict applies to the exact revisions above; a later dev tip
requires a fresh comparison.

The final snapshot includes dev's `efc26426` driver-trip query batching change (two
application modules and three test files), plus the Docker fixture correction below.
The comparison again found no conflicts and no differences between the snapshot's
backend/shared-contract/build inputs and the expected combination. The migration files
are identical between the two dev revisions.

### Existing dev CI blockers

The combined snapshot fails mypy on an incoming test:

```text
backend/tests/unit/test_incident_response_guide.py:28:
error: Need type annotation for "base" [var-annotated]
```

Full mypy on an untouched archive of `origin/dev@51d35bc2` reproduces exactly the same
single error (709 source files, versus 721 in the combined snapshot). Thus the failure
is already present on dev, rather than introduced by FP-299 or the combination. It needs
an upstream test-typing correction for a green backend CI run after integration. The
incoming incident test was not added to or edited in this feature working tree.

The combined suite also fails
`tests/baseline/test_b1_api_contract.py::test_openapi_document_matches_committed_snapshot`:
the live `order_number` schema permits `null`, while the committed snapshot expects only
`string`. The same targeted test on untouched `dev@51d35bc2` reproduces the mismatch.
The five-file `efc26426` update changes neither this schema/snapshot nor the incident
test.

That update introduces a third failure: `scripts/check_structure.py` reports
`app/orchestration/trips/queries.py::list_trips_for_driver` at **102 lines**, above the
**100-line** function limit. The feature does not modify this module or the structure
baseline. All three failures need upstream correction for a green combined backend CI
run; the structure limit and snapshot were not relaxed as part of this review.

A final untouched backend archive of **`dev@efc26426`** independently reproduced all
three failures with the same runner dependencies: structure check exit 1, full mypy
exit 1 (709 files; the same single annotation error), and the targeted OpenAPI test exit
1 (the same nullable `order_number` diff). Thus none depends on the FP-299 source changes
or the combined-snapshot construction. Logs are `dev-latest-structure.log`,
`dev-latest-mypy.log` and `dev-latest-openapi.log` in the retained local review directory.

### Docker compatibility correction made during review

Incoming `test_analytics_chat_definitions.py` reads the analytics page's `copy.ts` and
`costCopy.ts`. The first combined image omitted those frontend files, causing four
`FileNotFoundError` failures. `infrastructure/docker/Dockerfile.load` now copies both
explicitly, and `Dockerfile.load.dockerignore` allows those two paths. Both the current
and latest combined images rebuild successfully. All four previously failing
analytics-copy contract tests pass in the final combined suite.
This correction changes no backend Python source, so the original evidence digest still
matches the feature working tree.

## Cancellation limitation: baseline comparison

The documented server-side cancellation limitation was reproduced independently using
the real API harness, asyncpg 0.32.0 and disposable PostgreSQL. Three requests were
confirmed waiting on a table lock before cancellation, and the lock stayed held during
the subsequent two-second observation.

| Engine factory | Trials | Queries still waiting after two seconds in each trial | Checked-out API connections | Recovery |
| --- | ---: | --- | ---: | --- |
| Current FP-299 | 3 | 3 / 3 / 3 | 0 | Reads and committed write passed |
| Committed FP-275 factory from local HEAD | 3 | 3 / 3 / 3 | 0 | Reads and committed write passed |

The API tasks and relay sockets settled in both cases. The current factory logged
SQLAlchemy cancellation-related termination errors; the old factory also logged closing
errors. This confirms a **pre-existing limitation**, not a regression introduced by
removing the discard listener. It remains tracked in [known issue 4](../known-issues.md#4-api-database-timeout-policy--local-load-validated-deployment-calibration-outstanding).
Command timeouts are covered separately by the strengthened server-side cancellation
assertion and the runner's lock-waiter checks.

## Fresh verification

Checks use separate review-owned Docker Compose projects with disposable PostgreSQL and
Redis, an internal network, no published ports and no developer environment files.
The initial current/combined projects ran concurrently on the same host; the final
latest-dev static checks, suite, cold imports and smoke matrix ran sequentially, with
pytest's temporary artifacts retained outside its auto-removed container.

| Check | Current tree | Initial combination (`51d35bc2`) | Final combination (`efc26426`) |
| --- | --- | --- | --- |
| Ruff | Pass | Pass | Pass |
| mypy | Pass, 684 files | 1 pre-existing dev error, 721 files | Same dev error, 721 files |
| Structure ratchet | Pass | Pass | Dev's 102-line function fails the 100-line limit |
| Import-linter | 17 kept, 0 broken | 17 kept, 0 broken | 17 kept, 0 broken |
| Dependency consistency (`pip check`) | Pass | Pass | Pass |
| Full backend `pytest -m "not slow"` | 4,241 passed, 1 failed, 4 skipped | 4,399 passed, 6 failed, 4 skipped | 4,409 passed, 1 upstream failure, 4 skipped |
| Cold imports | 313 passed | 334 passed | 334 passed |
| Full smoke matrix | 39/39 passed | 39/39 passed | 39/39 passed |
| Migration head count | 1 (`ciaran_driver_transfer_v2`) | 1 (`tim_add_driver_push_tokens`) | Same migration files as initial combination |
| Entire migration chain on fresh PostgreSQL | Pass | Pass | Same migration files as initial combination |

The initial combined suite's six failures were the recovery test, four missing frontend
fixture tests, and the upstream OpenAPI mismatch. The separate full smoke run passed
with maximum recovery-read completion **0.3975 s**; its raw samples were independently
audited. Fresh smoke artifacts: [current](fp-299-results/review-current-smoke.json) and
[initial combination](fp-299-results/review-combined-smoke.json).

The final combined suite ran in **371.55 s**. Its only pytest failure is the upstream
OpenAPI mismatch; FP-299's integration test and the strengthened command-cancellation
regression tests pass. Slow import tests were selected separately (313 deselected in
the current full run, 334 in each combined full run).

The [final smoke artifact](fp-299-results/review-latest-smoke.json) independently audits
to **39 passing cycles, 1,782 load attempts, 507 successful recovery requests,
39 committed writes and 40 warm-ups**, with maximum recovery-read completion **0.3432 s**.
No watchdog fired; requests completed within their declared scenario bounds and pool/task
settlement assertions passed. The [final integration artifact](fp-299-results/review-latest-integration.json)
audits to **12 passing cycles, 144 load attempts, 156 successful recovery requests,
12 committed writes and 16 warm-ups**, with maximum recovery-read completion **0.1816 s**.

Migration checks use the repository's existing CI Supabase stub and a separate disposable
`freightproof_migrations` database. Each final `alembic_version` was checked against the
expected head. The application test database and shared Supabase were not migration targets.

### Recovery failure in the first integration-suite runs

The current-tree suite's sole failure was
`test_db_timeout_load.py::test_standalone_load_records_failure_recovery_and_removes_its_schema`.
The subprocess reported `Healthy recovery wave did not fully succeed` on its third
command cycle. Its temporary JSON was removed with the disposable test container; the
pytest failure log is retained. The subsequent separate full smoke matrix passed all
39 cycles with the same source digest, with maximum recovery-read completion **0.9110 s**.

The [combined suite's subprocess artifact](fp-299-results/review-combined-integration-initial.json)
was captured before container teardown. It
likewise records recovery failures: command repetition 3 and half-open-command repetitions
2 and 3 each had **11 successful reads and one pool-timeout 503**. Those failed reads took
**543.307, 553.682 and 556.938 ms**, against the smoke profile's **500 ms pool-wait budget**.
All fault assertions passed; recovery writes committed, checked-out connections returned
to zero, and tasks/sockets settled. The failures must not be counted as passing recovery.

The review ran independent stacks concurrently on the same Docker host. Shared-host
contention is a plausible explanation for the short-budget sensitivity, but it does not
erase the failed tests. A focused current-tree recheck while the combined suite was still
running also failed (47.15 s): five recovery cycles returned a total of 19 pool-timeout
503s. Its [JSON is retained](fp-299-results/review-current-integration-recheck.json).
No source, budget, assertion or success criterion was changed to obtain a pass. A recheck
without competing review suites **passed unchanged in 25.67 s**. Its
[retained artifact](fp-299-results/review-current-integration-quiet.json) independently
audits to 12 passing cycles, 144 load attempts, 156 successful recovery requests,
12 committed writes and 16 warm-ups. Maximum recovery-read completion was **0.2007 s**.

This demonstrates short-budget sensitivity under competing host workloads. It is not
evidence that a 500 ms pool-wait budget suits every machine or deployment, and the failed
runs remain part of the review. The final combined suite checked recovery again in the
context of the whole suite without competing review jobs, and it passed.

Review logs, comparison scripts and cancellation probes are retained locally under
`%LOCALAPPDATA%\Temp\opencode\fp299-review\`. Fresh smoke artifacts use new filenames;
the original smoke and default-budget evidence files are preserved.

The suite still emits existing `python-jose` `datetime.utcnow()` deprecations, Pydantic
serializer warnings, an unawaited-mock warning and Redis's shutdown `Event loop is
closed` diagnostic. Cancellation fault cycles also log SQLAlchemy termination errors
as described above. Passing assertions are not a claim of warning/error-log-free runs.

## Handoff

The shared-file change in `backend/requirements.txt` requires **asyncpg >= 0.32.0**.
Reinstall backend requirements or rebuild existing application environments when adopting
the change. No migration or new environment key is introduced by FP-299.

Suggested commit: `test(db): verify database timeout recovery under concurrent load`.

The review changed only the two FP-299 Docker files and added this report plus new review
artifacts. It preserved the pending application implementation and the original evidence.
The review-owned current, combined, latest, migration and cancellation-probe Compose
projects have been removed after verification. Local logs, source snapshots and runner
images remain available for reproducing the findings.

No migration or new environment key is required. The shared-file change is
`backend/requirements.txt`; adopt its asyncpg floor together with the engine change.
Scope, source/evidence identity, import contracts, dependency consistency and content
compatibility checks pass. **Overall green-CI sign-off: FAIL**, for the three upstream
checks listed above, with smoke-budget sensitivity also disclosed. Coordinate those
upstream corrections and refresh the comparison if dev advances before integration.
Final `git diff --check` and whitespace checks across all pending files passed; the
feature and combined source digests remain as recorded above.
Nothing has been staged, committed or pushed.
