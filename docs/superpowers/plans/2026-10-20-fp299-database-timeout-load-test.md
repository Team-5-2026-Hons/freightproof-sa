# FP-299 — Database timeout load-test plan

**Status:** Implemented; original smoke and default-budget evidence records 39/39 cycles
each at digest `f56105b2…`; see the [execution report](../../testing/fp-299-database-timeout-load.md).
Later integration fixes and the dedicated CI profile are tracked in the
[integration verification](../../testing/fp-299-integration-fixes.md).
Jira FP-299 stays In Progress until review and merge.
**Owner:** Chiko. **Jira:** [FP-299](https://inf4027team5.atlassian.net/browse/FP-299).
**Prepared:** 20 October 2026, after incorporating the latest `dev` into local `Chiko`.

## 1. Baseline and outcome

- FP-275 is submitted as [PR #94](https://github.com/Team-5-2026-Hons/freightproof-sa/pull/94),
  `Chiko` -> `dev`. Its pushed tip is `e524b8c1`; the timeout implementation is `4f3dcf04`.
- Local merge `b869bdbb` combines that work with `origin/dev` at `a2afc1a5`.
  The merge completed without conflicts.
- The committed graph describes `5d906bc5` and predates both changes. The existing graph
  was queried for the database/session/health paths; current source is authoritative.
- [FP-275 verification](../../testing/fp-275-database-timeouts.md) establishes individual
  timeout mechanisms. Its recorded results use an older base, `d16c9287`.

**Outcome:** a small, repeatable concurrent-load run against disposable PostgreSQL,
with evidence that API requests finish with the expected response, release connections,
and recover after each fault. Retain commands, configuration and measured results for
the final project document.

## 2. What changes in this plan after pulling dev

| Code at planning time | Consequence for FP-299 |
| --- | --- |
| `app/db/engine.py:create_db_engine`, `AvailabilityPool`, bounded discard | Exercise the real FP-275 factory and its pool. A default SQLAlchemy test engine would test a different policy. |
| `app/db/session.py:DatabaseSession`, `get_db`, `get_read_only_db` | Keep one session per request and the real commit/rollback/close lifecycle. The ordinary `db_session` fixture shares a transaction and is unsuitable for concurrent requests. |
| `app/main.py:database_unavailable_handler` | Verify the exact database 503 body and structured failure reason/operation, rather than counting every 503 as a database timeout. |
| New driver-substitution/custody routes and changed trip/handover shapes (FP-83) | Seed from current models and use current payloads, custody sequence and driver context. Add a substitution read to the representative workload and rerun the affected contract checks. |
| New analytics chat (FP-295) | Its request session can remain checked out after a tool query while subsequent provider calls run. Include a controlled slow-provider case and measure the effect on unrelated reads. |
| New analytics view definition with `shared_trip_count` | Build the current views using the migration statements already used by analytics tests; `Base.metadata.create_all()` alone does not create them. |
| New Anthropic dependency in `requirements.txt` | Install the merged requirements in the isolated runner, even when provider calls are faked. An older FP-275 image may fail during application import. |
| `tests/conftest.py` now isolates custody-anchor publishing too | Account for phase, evidence and custody publishers in the harness so a write probe does not launch background work on another database engine. |

The current API pool defaults are **2 retained + 1 overflow** connections per process.
The timeout defaults are **10 s connect / 20 s pool wait / 30 s command / 5 s cleanup**.
They are provisional operating budgets. Measure them before proposing tuning.

## 3. Implementation files

Paths below are relative to the repository root.

| File | Purpose |
| --- | --- |
| `backend/scripts/load_db_timeouts.py` | Explicitly invoked async load runner, scenario selection, concurrency control and result export. Use existing `asyncio`/`httpx` dependencies. |
| `backend/scripts/db_timeout_load/` | Small configuration, fixture, metrics, relay, app harness, chat-provider, scenario and runner modules. |
| `backend/tests/unit/test_load_db_timeouts.py` | Meaningful harness checks: reject unsafe/missing targets, preserve failed/cancelled samples, fail on watchdog expiration, and validate result accounting/percentiles. |
| `backend/tests/integration/test_db_timeout_load.py` | One standalone subprocess run: three repeated pool, lock-bound command, half-open command and idle pre-ping fault and persisted-write recovery cycles, task/connection settlement and schema cleanup. |
| `backend/app/db/engine.py`, `backend/app/db/session.py`, `backend/requirements.txt` | Focused fix for the discard defects the repeated faults exposed: require asyncpg 0.32 and remove the custom discard listener, so SQLAlchemy's bounded close also cancels the statement on the server. `requirements.txt` is a shared file. |
| `infrastructure/docker/Dockerfile.load`, companion `.dockerignore`, `docker-compose.load.yml` | Reproducible Python runner and isolated PostgreSQL/Redis, internal network, no published ports, no developer `.env`. |
| `docs/testing/fp-299-database-timeout-load.md` | Exact setup/run commands, scenario contracts, environment versions, results and interpretation. |
| `docs/testing/fp-299-results/` | Sanitized machine-readable reports of the final runs, plus the two asyncpg 0.31 failure runs the findings cite. Superseded development runs are archived outside the repository. |
| `docs/known-issues.md`, section 4 | Link the measured evidence and state precisely which limitation it closes once results exist. |
| `docs/testing/fp-275-database-timeouts.md`, `backend/tests/integration/test_db_timeouts.py` | Correct the superseded discard semantics, remove the listener's now-dead cleanup budget from the FP-275 fixture, and assert that a timed-out statement is cancelled on the server. |

Reuse the fault patterns in `tests/integration/test_db_timeouts.py`, including its
stalled handshake and `SilencingProxy`. If a helper is extracted for reuse, keep that
refactor confined to test support and rerun the existing FP-275 tests.

As built, `scripts/db_timeout_load/proxy.py` is a separate relay rather than a reuse:
the load runner must also account for every relay task and socket after each cycle, and
relays are tracked by identity. Sharing one relay with the FP-275 tests can follow once
PR #94 has merged.

Production timeout settings, migrations and API routes need no planned changes.
Any genuine regression exposed by the run should get a focused fix and its own evidence.

## 4. Harness and environment

1. Run a clean source snapshot in an isolated Python 3.13+ environment with the merged
   runtime/test requirements. Include `frontend/shared` for backend contract tests.
   The runner's working directory must contain no `.env`; supply throwaway settings
   explicitly before importing the application.
2. Use the dedicated `infrastructure/docker/docker-compose.load.yml` project, with the
   same PostgreSQL 17/test-database convention as `docker-compose.test.yml` plus isolated
   Redis for chat-budget behaviour. The separate project adds an internal network and
   removes host ports to keep fault injection isolated. Run suites and profiles serially.
3. Require an explicit `TEST_DATABASE_URL` targeting `freightproof_test` on a local
   host or the known test service. Validate it before any connection, schema operation
   or fault injection; set the isolated API `DATABASE_URL` to that same target.
   Never fall back to a developer's `DATABASE_URL` or shared Supabase project.
4. Build current model tables and current analytics views using the established test
   setup approach in `tests/integration/test_analytics.py`. Commit synthetic seed data
   before launching concurrent requests so separate connections can see it. Use a
   separate setup/control connection; exclude it from API-pool measurements.
5. Wire the real `app.main.app`, `create_db_engine(settings)`, `DatabaseSession` and
   `AsyncSessionLocal`. Keep `get_db` and its transaction teardown intact. Use one
   engine per scenario, and keep that engine alive through its fault/recovery cycles.
6. Use `httpx.AsyncClient` with `ASGITransport(raise_app_exceptions=False)` for a
   repeatable in-process HTTP workload with real PostgreSQL traffic. Record this
   topology: its timings measure application/database behaviour, not proxy/network
   overhead or deployed request throughput.
7. Supply a synthetic authenticated identity at the auth boundary, preserving real
   database services and organization scoping. Keep partner integrations and AI calls
   controlled. Stub phase/evidence/custody anchor dispatch in the harness when needed;
   do not rely on broker failure to select an in-process fallback.
8. Disable rate limiting explicitly for the database-isolation runs and record that
   choice. A 429 from a limiter or chat budget is a separate result, never timeout proof.
9. Use an independent `asyncio` watchdog. HTTPX's transport timeouts alone do not bound
   an in-process ASGI call. A watchdog firing makes the scenario fail; it must not be
   recorded as the application correctly timing out.

Use the same effective settings for the engine and the session module: engine creation
receives a settings object, but `DatabaseSession._cleanup` reads module-level settings.
Configure both together before construction and restore all overrides at teardown.

## 5. Workload and scenario matrix

### Profiles

- **Smoke:** production pool size, shorter explicit budgets for fast harness checks.
  Initial proposed values: 0.5 s connect, 0.5 s pool wait, 1 s command, 0.5 s cleanup.
  These are fault-test parameters, not recommended deployment settings.
- **Evidence:** current defaults (2 + 1 pool; 10/20/30/5 s timeouts). Record actual values
  and resolved dependency versions in every result file.
- Healthy runs: concurrency **1, 3, 6, 12**, initially 120 requests per level, three
  repetitions. Use a fixed finite workload, warm-up before measurement and record
  wall-clock duration. Treat these as a bounded concurrency sweep, not a capacity SLA.
- Fault runs: synchronized waves at concurrency **12**, three fault/recovery cycles
  per scenario. Record pool-holder/control operations separately from HTTP attempts.

Use actual trip-list/detail reads and
`GET /api/v1/trips/{trip_id}/driver-substitutions` for the representative mix. Add a
current analytics read with its required views. Keep IDs and data synthetic. Validate
each route at concurrency 1 before including it in a fault run.

| Scenario | Controlled stimulus | Required observations |
| --- | --- | --- |
| Healthy baseline | Run the real read mix at each concurrency level. | Latency distribution and throughput; validate successful payloads; report any unexpected 4xx/5xx or connection leak. |
| Pool exhaustion | Hold all three slots on the API engine, confirm the holders are ready, then launch a request wave. Release holders after the wave. | Waiting requests produce the database 503 with `pool_timeout`; slots return and a healthy wave succeeds on the same engine. |
| Connect timeout | Direct a scenario's engine through a local relay that accepts TCP but stalls the PostgreSQL handshake. Restore forwarding afterwards. | `connect_timeout` (and explicitly accounted pool waiters), bounded completion, no stranded slots; fresh connections work after fault removal. |
| Command/lock timeout | Hold a conflicting lock on a synthetic table/row read by the selected real endpoint using the control connection. Release the lock after timeouts. | `command_timeout` for requests that reached SQL; distinguish queued `pool_timeout` requests; rollback/discard completes and the next healthy wave succeeds. |
| Half-open command and idle pre-ping | Warm connections through the relay; silence existing connections while allowing fresh connections. Run active-command and next-checkout cases separately. | `command_timeout` or `checkout_timeout`, bounded discard and fresh-connection recovery. Confirm faulted connections were actually exercised; not every concurrent request must fail. |
| Cancellation under contention | Cancel a defined subset after confirming they reached pool wait or SQL; let the other requests finish. | Cancellations are counted separately; remaining requests terminate; checked-out count returns to zero and recovery succeeds. |
| New chat connection-hold case | Fake a provider reply that requests a real analytics tool; delay the reply after that tool has queried the DB. Run ordinary reads concurrently. | Measure checkout/hold time, read latency and any pool timeouts. Delay below and above the pool-wait budget; distinguish deliberate pressure from unexpected baseline failure. |

For chat, reuse the existing fake-provider approach from `tests/fake_ai_provider.py` and
the current endpoint tests. A disabled chat's 503, a model/provider 503, or a budget 429
does not exercise database availability. Confirm a real tool query occurred before the
controlled provider delay. Apply the database fault during that query in a focused case
to verify it reaches the shared database handler.

Add a small successful mutation/recovery probe on committed synthetic data using a
current endpoint contract. Verify persisted state after a known successful response.
Do not automatically retry a timed-out write: a lost commit acknowledgement is ambiguous.
Existing FP-275 conflict/cleanup tests remain the regression proof for preserving a
primary 409 when rollback fails; rerun them on this merged baseline.

## 6. Measurements and pass criteria

For every scenario/profile/repetition retain:

- commit and dirty-tree state, timestamp, OS/container resources, Python/PostgreSQL/
  SQLAlchemy/asyncpg versions, worker count and effective timeout/pool settings;
- concurrency, requests attempted/completed, wall-clock duration and completion rate;
- response counts by status and expected body category; structured database reason and
  operation counts; independent watchdog and explicit cancellation counts;
- latency min/p50/p95/p99/max, with sample count and a documented percentile method,
  separately for success and each failure category;
- pool checkout/checkin/invalidation observations, peak checked-out count, connection
  hold durations and final checked-out count;
- time from fault removal to a successful healthy recovery wave.

Measure request time with a monotonic clock. Capture all outcomes, including failures;
do not calculate an apparently healthy percentile after dropping timed-out requests.
Warm-up and administrative operations have their own counters.

**Pass requires:**

1. The intended fault is evidenced by the stimulus and the expected database reason;
   all requests are accounted for and no watchdog fires.
2. Application timeouts, cleanup and pool release finish within a scenario-specific
   envelope derived before the run. Include pool wait, possible pre-ping/reconnect,
   the commands executed, cleanup/discard and an explicit scheduler allowance.
   No single timeout setting is advertised as an end-to-end request deadline.
3. The API pool never exceeds its configured 2 + 1 bound, and checked-out connections
   return to zero after holders/tasks settle. Idle pooled connections are normal.
4. Each fault is followed by successful reads and the selected mutation probe using
   the same API engine, without restarting the app or PostgreSQL.
5. Three repeated fault/recovery cycles finish with no accumulating tasks, leaked
   connections, unexpected 500s or poisoned-session failures.

The normal profile should have no unexpected database 503s. If ordinary partner/chat
holds exhaust the small pool, preserve that result and discuss calibration or transaction
lifetime; do not silently enlarge the pool or discard the failing run.

## 7. Execution order and verification

1. **Establish the merged baseline.** Once Docker is available, run the existing FP-275
   unit, real-database and failure-propagation suites, plus pool/health regressions.
   Rerun handover, driver-substitution/transfer, analytics/chat and API-contract tests
   affected by the incoming `dev` changes. Reassess failures on this baseline instead
   of copying the older FP-275 report's pre-existing-failure list.
2. **Build the small runner.** Implement target validation, isolated fixtures, one
   session per request, complete result accounting and the healthy/pool-exhaustion
   scenarios first. Unit-test the runner's failure reporting and watchdog semantics.
3. **Add controlled faults and current-route cases.** Connect, command/lock, half-open,
   cancellation, chat holds and the mutation recovery probe. Verify the smoke profile
   and fail the command with a nonzero exit code for any failed scenario.
4. **Record evidence.** Run the evidence profile three times against the same documented
   topology. Retain sanitized JSON plus a concise results table and exact reproduction
   commands. Recheck asyncpg 0.31 half-open recovery as a supported-version regression
   if it remains inside the project's allowed range; record that separately from the
   primary run's resolved version. (As built, the range no longer includes 0.31; see the
   execution outcome.)
5. **Validate the implementation.** Focused Ruff/mypy and the new harness unit checks,
   then the backend CI test stages on the disposable database/Redis:
   `pytest -m "not slow"` and
   `pytest -m slow tests/baseline/test_b7_import_cycles.py`.
   Run import-linter if support extraction affects import boundaries.
6. **Publish the result and update issue 4.** Link the run evidence and update the final
   document's database-timeout limitation using measured claims. Mark FP-299 complete
   only when the reproducible run meets the criteria.

### Planning-time verification

- `origin/dev` is an ancestor of local `Chiko` after merge `b869bdbb`.
- All five auto-merged Python files pass syntax parsing.
- Docker Desktop's Linux engine was unavailable, so database/runtime checks were not
  rerun during planning. PR #94 triggered CI; its outcome is separate from these checks.
- The full incoming diff has five trailing-blank-line warnings in files supplied by
  `dev`; they are unrelated to the timeout merge or this plan.

### Execution outcome — 20–21 October 2026

- The merged-baseline regression selection passed before implementation (242 tests; that
  run's log was not retained).
- Repeated faults exposed two problems with the connection-discard listener. FP-275's
  listener could leave sockets open on asyncpg 0.31; a first fix that aborted the socket
  before graceful close settled them, but a review showed it also stopped PostgreSQL's
  cancel, so timed-out statements kept running on the server. The final change requires
  asyncpg 0.32 in `requirements.txt` (a shared file) and removes the listener, because
  0.32 bounds its own close and still sends the cancel. A new FP-275 assertion and the
  lock scenarios' "statements left waiting" check guard this.
- A final multi-agent review (correctness, project rules, structure, docs, tests,
  isolation, each adversarially verified) led to the harness refactor: one definition of
  the pool shape and scenario names, separate envelope and watchdog names, argparse
  scenario validation, atomic report writes, the runner module, fuller unit tests, a
  single-subprocess integration test, a real Docker allowlist, and a doc that states
  the Jira outcome plainly.
- Step 4's "three times" was met as three repetitions of every scenario within one
  evidence-profile run, rather than three separate runs.
- A final independent check found that a request cancelled mid-query through the app
  leaves its statement queued in PostgreSQL. That is documented as an open item in the
  report and known issue 4, not changed here.
- Final smoke and default-budget runs each passed 39/39 cycles: 1,782 load requests,
  507 successful recovery requests including 39 committed writes, and 40 warm-up
  requests, with no watchdog, no request over its envelope and nothing left unsettled.
  Superseded development runs are archived outside the repository.
- The execution report records the source digest, commands, versions, measured tables,
  backend verification and interpretation limits. Known issue 4 records the demonstrated
  local behaviour, the driver change and the remaining deployment calibration.

## 8. Evidence interpretation

This closes the specific claim about demonstrated **API database timeout and recovery
behaviour under the documented concurrent load**, if the run passes. A local result
does not establish hosted Supabase/Supavisor capacity, deployment p99 or calibrated
production defaults. Keep any outstanding deployment calibration explicit in issue 4.

The API and task engines are separate. This run does not establish Celery/fallback
timeouts or Hedera receipt latency. In particular, the final document's SO-1
"receipts within 60 seconds" figure needs its own anchoring measurement; do not derive
it from this database load report. The 20 October document review originally identified
FP-299's claimed completion/results as unsubstantiated. The retained execution report
now supplies the scoped local API database evidence; anchoring latency remains separate.
That review is [Iteration4_Document_Code_Review_2026-10-20.md](../../iteration4/Iteration4_Document_Code_Review_2026-10-20.md).
