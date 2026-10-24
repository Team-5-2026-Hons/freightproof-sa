# FP-299 — Integration fixes and verification

## Integration

The user explicitly authorized a one-time exception to the repository's no-commit/no-merge
rule. All 36 pending FP-299 files were backed up with a SHA-256 manifest under
`%LOCALAPPDATA%\Temp\opencode\fp299-review\before-authorized-integration\`.

- Feature commit: `280f32f1` (`test(db): verify database timeout recovery under concurrent load`).
- Integrated dev: `4a14ca24`.
- Local merge: `dbe952c5`; Git's `ort` merge completed without conflicts on `Chiko`.
- No push was performed.

The existing graph was queried; its `5d906bc5` source predates the feature and the incoming
incident code. Current source and tests were used to validate the changes below.

## Corrections

1. **Incident-test typing:** `_facts` now declares its keyword argument types directly
   and constructs `GuideFacts` explicitly. It preserves the existing fixture values and
   removes the heterogeneous untyped dictionary that failed mypy.
2. **OpenAPI snapshot:** only `TripSummary.order_number` was updated to allow null.
   This matches the existing FP-281 schema and the existing integration regression
   `test_build_audit_manifest_trip_without_order_number_succeeds`; no API behaviour changed.
3. **Driver-list structure:** extracted pure response construction to `_driver_list_item`.
   The authorization filters, ordering, batched queries, custody calculation and response
   fields are preserved. Existing driver-trip and substitution tests cover these contracts,
   including the batched-query limit. The structure threshold was not relaxed.
4. **CI recovery timing:** added the `ci` load profile (connect 2 s, pool wait 3 s,
   command 2 s, cleanup 1 s) and selected it in the subprocess integration test. The same
   profile applies during faults and recovery. The test asserts the recorded profile and
   budgets, the required fault reasons, all successful recovery reads, committed writes,
   pool/task settlement and schema removal. No retry or accepted recovery failure was added.
   An independent 180-second whole-subprocess limit supplements per-request watchdogs.

The earlier Docker correction remains included: both dispatcher analytics wording files
are copied into the load-test image for incoming backend contract tests.

## Verification

Checks run serially against a dedicated `fp299-integrated` Compose stack, using disposable
PostgreSQL/Redis and no published ports. A separate recovery recheck caps the runner at
one CPU to exercise scheduling headroom. Original smoke/default-budget artifacts and the
failed review artifacts are preserved; new reports carry the merged source digest.

**Backend integration verdict: PASS.** The previously reproduced mypy, structure and
OpenAPI failures are resolved in the actual merged working tree.

| Check | Result |
| --- | --- |
| Ruff | Pass |
| mypy | Pass, 721 source files |
| Structure ratchet | Pass without changing the baseline or thresholds |
| Import contracts | 17 kept, 0 broken |
| Dependency consistency | Pass |
| Full backend suite (`pytest -m "not slow" -q`) | **4,416 passed, 4 skipped, 334 deselected**, 444.22 s |
| Separate cold imports | **334 passed**, 44.96 s |
| CI recovery test with one CPU quota | **1 passed**, 54.05 s |
| Original smoke-profile full matrix | **39/39 passed** |
| New CI-profile full matrix | **39/39 passed** |

The four fresh artifacts share the independently recomputed backend Python digest
`1bf17df7f48220cb322fdea8f3849acec8bcba4cc6cbabae74a08f4305cf6ad3`.
They were captured at merge base `dbe952c5` with the corrective source edits present;
the full matrix reports explicitly record `dirty: true`. The pytest subprocess labels
are test metadata; the digest identifies their exact source.

| Retained artifact | Cycles | Load attempts | Successful recovery requests | Committed writes | Maximum recovery-read completion |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Smoke matrix](fp-299-results/integrated-smoke.json) | 39 | 1,782 | 507 | 39 | 0.4776 s |
| [CI matrix](fp-299-results/integrated-ci.json) | 39 | 1,782 | 507 | 39 | 0.4183 s |
| [One-CPU CI regression](fp-299-results/integrated-one-cpu.json) | 12 | 144 | 156 | 12 | 0.2150 s |
| [CI regression within full suite](fp-299-results/integrated-suite-load.json) | 12 | 144 | 156 | 12 | 0.2396 s |

Independent auditing recomputed counts and latency percentiles from raw samples and
checked request bounds, expected outcomes, committed recovery writes and resource
settlement. All assertions passed. Full matrices each include 40 successful warm-ups;
each regression run includes 16. The one-CPU artifact records cgroup quota/period
`100000 100000`, confirming the resource cap actually applied. This verifies the revised
profile on the tested constrained host, not an SLA for arbitrarily overloaded machines.

The original default-budget evidence remains a historical run of its recorded source;
it was not rerun after this integration. Production timeout settings and the engine
implementation were not changed by these corrective edits. Existing deprecation and
serializer warnings, an unawaited-mock warning, Redis's shutdown diagnostic, and
cancellation-related SQLAlchemy termination logs remain as described in the initial review.

Full logs and pytest artifacts are retained under
`%LOCALAPPDATA%\Temp\opencode\fp299-review\integrated\`. The disposable Compose stack
was removed after verification.

## Handoff

The existing FP-299 dependency requirement remains **asyncpg >= 0.32.0**; rebuild or
reinstall backend requirements when adopting the change. These corrective changes add
no migration or application environment key and do not modify application timeout defaults.
The previously documented deployment calibration and server-side request-cancellation
limitation remain in [known issue 4](../known-issues.md#4-api-database-timeout-policy--local-load-validated-deployment-calibration-outstanding).
