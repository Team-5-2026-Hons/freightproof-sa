# FP-299 — Database timeouts under concurrent load

## Summary

FP-299 asks for "a documented run showing requests fail fast and recover rather than
hang under load". On a disposable local stack, using the API's real engine, sessions and
error handlers:

- **No request hung.** Both profiles passed **39/39 cycles**. Every one of the 1,782 load
  requests in each profile ended as a valid 200, the shared database 503 with its logged
  reason, or a deliberate cancellation, inside the bound declared for its scenario
  before the run. The independent watchdog never fired.
- **Failures are bounded; at the default budgets they are not fast.** With the short
  smoke budgets, failed requests returned in 0.5–2.4 s. With the code's default budgets
  they returned after about 20 s (waiting for a pool slot), 10–30 s (connecting) or
  30–32 s (a stalled command or pre-ping). The defaults stop a request from hanging;
  choosing values that also fail fast for a user is the deployment calibration still
  open in [known issue 4](../known-issues.md).
- **Recovery needs no restart.** After every fault, 12 reads on the same pool succeeded
  within 1.64 s of the fault being removed. One write followed, and each was confirmed
  as committed on a separate connection (39 per profile).
- **Timed-out statements also stop on the server.** In every command and chat-database
  lock cycle, no timed-out statement was still waiting in PostgreSQL once its request had
  returned 503. A request that is *cancelled* mid-query is different: a separate probe
  found its statement stays queued (see
  [cancellation](#a-cancelled-requests-statement-keeps-waiting)).
- **One production change.** Repeated faults showed FP-275's discard listener leaving
  sockets open on asyncpg 0.31, and the first replacement listener stopping PostgreSQL's
  cancel. FP-299 therefore requires asyncpg 0.32 and removes the listener
  ([findings](#discard-findings-and-the-asyncpg-032-requirement)).
- **One new pressure point.** An analytics-chat request keeps its database connection
  while it waits for the AI provider. With all three pool slots held for 5 s, every
  concurrent read waited about 5 s; with 25 s, they failed with pool timeouts.

Terms used below:

- **Envelope:** the longest a request in a scenario may take, derived from the timeout
  budgets before the run. A request over its envelope fails the cycle.
- **Watchdog:** an independent timer 5 s past the envelope. If it fires, the request
  counts as hung and the cycle fails; it is never counted as the API timing out.
- **Settled:** after a cycle, no request task is left and only the pool's retained
  connections still have an open socket through the fault relay.

## Scope and environment

The runner exercises the real FastAPI application, `create_db_engine`, `DatabaseSession`
and the request commit/rollback/close lifecycle through HTTPX's in-process ASGI transport.
PostgreSQL traffic passes through a local TCP fault relay. A synthetic identity replaces
sign-in; organization-scoped services and SQL stay real. Rate limiting is disabled.

Source base: local `Chiko` at merge `b869bdbb` (FP-275 plus `dev` at `a2afc1a5`), with the
uncommitted FP-299 changes. Each report records that revision, a dirty-tree flag and a
SHA-256 of the backend's Python source (LF-normalised, so it does not depend on the
checkout's line-ending setting). Both final reports record
`f56105b283d55383a0116e292b3e46a21e7a8f94961340ca47dee872014556ac`, the same digest as the
working tree they were built from. Warm-up requests run separately and are excluded
from load timing.

| Component | Value |
| --- | --- |
| Host/runtime | Windows, Docker Desktop 4.73.0 (Engine 29.4.3), Linux x86_64 / WSL2 6.6.114.1 |
| Docker VM resources | 16 logical CPUs, 8,009,101,312 bytes RAM (from `docker info`); shared developer machine |
| Runner limits | No extra container CPU or memory cap; one process and worker |
| Python | 3.13.16 |
| PostgreSQL | 17.11, `postgres:17-alpine` |
| Redis | Dedicated `redis:7-alpine`, persistence disabled |
| SQLAlchemy / asyncpg | 2.0.55 / 0.32.0 |
| FastAPI / HTTPX / Pydantic | 0.115.14 / 0.27.0 / 2.14.0 |
| API pool | 2 retained connections + 1 overflow (the code default), pre-ping enabled |
| Smoke budgets | Connect 0.5 s; pool wait 0.5 s; command 1 s; cleanup 0.5 s |
| Evidence budgets | Code defaults: connect 10 s; pool wait 20 s; command 30 s; cleanup 5 s |

The dedicated Compose project has an internal network and no published ports, and
PostgreSQL keeps its data on tmpfs. Each run creates, and finally drops, only its own
`fp299_<uuid>` schema, using a separate non-pooled control connection. The fixture holds
one organization, a dispatcher, two drivers, a horse, two depots, three trips with six
stops and 21 phase-ledger rows, an immediate driver-substitution request and a notice.
Four existing analytics-view migrations supply the current read models. This is a small
functional fixture built from the current models, not a production-sized benchmark.

## Reproduce

Run from the repository root in PowerShell with Docker Desktop's Linux engine running.
`--env-file NUL` stops Compose from reading a developer's `.env` (on POSIX shells use
`--env-file /dev/null`), and the image's build allowlist excludes every `.env` file.

```powershell
$compose = @('--env-file', 'NUL', '-f', 'infrastructure/docker/docker-compose.load.yml')
$commit = git rev-parse --short HEAD
docker compose @compose build runner
docker compose @compose up -d --wait test-db test-redis

docker compose @compose run --rm --no-deps runner python -m scripts.load_db_timeouts --profile smoke --output /results/rerun-smoke.json --revision $commit
docker compose @compose run --rm --no-deps runner python -m scripts.load_db_timeouts --profile evidence --output /results/rerun-evidence.json --revision $commit

docker compose @compose down --volumes
```

Reports are written to `docs/testing/fp-299-results/`. Use new file names for a rerun,
as above, and replace the recorded `smoke.json` and `evidence.json` only when
deliberately re-recording, with the correct `--revision` (add `--dirty` for uncommitted
source). Rebuild after any Python edit, because the source is copied into the image. Run
the profiles one at a time, with nothing else using this database. The default-budget
faults deliberately take 11–18 minutes on this machine, depending on its load.

Exit code 0 means every selected cycle passed. A failure exits with 1, and the report
keeps every completed cycle's samples; if the runner itself stops, the report also
records the error type and the cycle it interrupted.

`--scenario` is repeatable: `healthy`, `pool`, `connect`, `command`, `half_open_command`,
`idle_ping`, `cancel`, `chat_short`, `chat_long`, `chat_database`. `--requests` sets the
healthy requests per concurrency level (default 120), and `--repetitions` the repetitions
per scenario (default 3; a healthy repetition runs one cycle at each of the four
concurrency levels, a fault repetition one cycle). The runner validates both targets before importing the app or
opening a connection.

## Workload and assertions

The representative read mix is trip list, trip detail, driver-substitution list and
driver analytics, and each response must contain the seeded records. Each scenario
first checks all four routes once. Healthy load sends 120 requests at each concurrency
of 1, 3, 6 and 12, three times over. Each fault wave sends 12 requests, four times the
pool's capacity, and each scenario runs three fault/recovery cycles on the **same engine
and pool**. The pool and connect waves use the four-route mix; the command, half-open,
pre-ping and cancellation waves use the trip list. The command, half-open and
cancellation faults target its query; the pre-ping fault is the checkout ping. The
chat short and long cases add three chat requests to the 12 reads, and the chat
database case sends 12 chat requests and no reads.

| Scenario | Stimulus and required observation |
| --- | --- |
| Pool | Hold all three slots; all 12 reads must return the database 503 with `pool_timeout`, none well before the pool-wait budget. |
| Connect | Invalidate the existing slots; accept TCP but stall new PostgreSQL handshakes. Require `connect_timeout`; reads still queued for a slot report `pool_timeout`. |
| Command | A control transaction holds `ACCESS EXCLUSIVE` on the synthetic `trips` table. Reads that reach SQL must produce `command_timeout`, and no statement may still be waiting in PostgreSQL afterwards. |
| Half-open command | Silence the existing sockets just before the first trip query is sent, after checkout. Require a real `command_timeout`; other concurrent checkouts and handshakes can also fail or succeed on fresh sockets. |
| Idle pre-ping | Warm all slots, return them, silence their sockets. Require `checkout_timeout` on the next checkout; fresh sockets stay usable. |
| Cancellation | Hold the trip lock; once three API queries wait in SQL, cancel six of the 12 callers, then release the lock. Exactly six must end as cancellations; the rest must succeed or return the correlated database 503. |
| Chat short / long | Three scripted providers each run a real analytics tool, then wait 0.25 or 1.25 times the pool-wait budget while their requests hold all three slots. Short holds must let every read succeed; long holds must cause pool timeouts; every chat request must succeed. |
| Chat database | Lock `trips` during the real analytics tool query; require the shared database `command_timeout` 503 rather than a chat-specific error, with no statement left waiting. |

After every cycle, 12 reads and one write (marking a notice as read) must succeed on the
same pool. The write is reset through the control connection first, and its committed
`read_at` is then confirmed on a fresh control connection. It starts no phase, evidence
or custody anchoring, and a timed-out write is never retried. The time from fault
removal to the end of the recovery reads is recorded separately.

Every attempted request keeps its outcome, HTTP status, payload check, database reason
and operation, and elapsed time on a monotonic clock. Only the exact
`503 {"detail":"Database temporarily unavailable."}` together with the shared handler's
logged reason counts as a database failure. The cycle fails on any unexpected status,
missing sample, wrong cancellation count, watchdog, request over its envelope, failed
recovery, checked-out connection left behind, relay error, statement left waiting on
the lock, or task or socket that does not settle.

Pool counters are cumulative within each scenario and include warm-up, recovery and the
harness's own connections, labelled `administrative`. A failed connect or pre-ping can
return a reserved slot without a successful checkout event, so checkins can exceed
checkouts. The pool never reports more than 2 + 1 connections checked out: SQLAlchemy
enforces that limit. The leak checks are therefore zero checked-out connections before
and after recovery, and at most two open relay sockets once the cycle has settled.

### Timing method and predeclared bounds

Percentiles use nearest rank (the value at position `ceil(p × n)` of the sorted samples)
and are reported with min, max and sample count, separately for success and each failure
category. Time spent queued in the load generator is excluded from request latency but
included in wave duration and the completion rate. Failed and cancelled requests stay in
the raw samples; none is dropped to improve a percentile.

Let `P/C/Q/L` be the pool, connect, command and cleanup budgets and `S = 5 s` an allowance
for scheduling and the fixture's ordinary local queries. The envelopes, declared before
any fault is injected, are:

- Pool: `P + 2L + S`.
- Connect: `P + C + 2L + S`.
- Other database and healthy cases: `P + 2C + 2Q + 4L + S`. That allows two connects
  (the first, and a reconnect after a failed ping), two command budgets (the ping and
  the faulted command) and four cleanup budgets (rollback, close and their discards),
  deliberately generous for a single faulted operation.
- Chat holds: the previous bound plus the controlled provider delay.

A discarded connection's close is bounded by SQLAlchemy at 2 s. That fits within `4L`
at the default budgets; with the shorter smoke cleanup budget, `S` absorbs it. These
bounds suit the small fixture, whose remaining ordinary queries fit the allowance. They
are not whole-request API deadlines: several successful commands and provider calls can
add time independently.

## Results

| Report | Cycles passed | Load requests | HTTP 200 | Database 503 | Cancelled | Recovery 200s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [smoke.json](fp-299-results/smoke.json) | 39/39 | 1,782 | 1,545 | 219 | 18 | 507 |
| [evidence.json](fp-299-results/evidence.json) | 39/39 | 1,782 | 1,545 | 219 | 18 | 507 |

The smoke run took 111.910 s (21 October 2026, 09:57:55–09:59:47 UTC). The default-budget
run took 1,104.825 s (21 October 2026, 10:00:00–10:18:25 UTC). Each profile also made 40
successful warm-up requests, which are excluded above. Each profile's recovery requests
were 468 reads and 39 writes confirmed as committed. Every attempt was accounted for; no
watchdog fired, no request exceeded its envelope, and there were no unexpected 4xx or 5xx
responses. The 219 database 503s were 168 `pool_timeout`, 21 `connect_timeout`,
21 `command_timeout` and 9 `checkout_timeout` in the smoke profile, and 164
`pool_timeout`, 25 `connect_timeout`, 21 `command_timeout` and 9 `checkout_timeout` at
the default budgets: in the connect scenario, how many queued requests reach the
connect timeout before their pool wait expires depends on timing.

These runs coincided with heavier background load on the shared machine than runs of
the harness a few hours earlier the same day: both profiles took about 1.7–1.9 times as
long (58.171 s and 645.707 s then), and healthy latencies were correspondingly higher
(for example, a concurrency-12 p50 of 318 ms against 121 ms). Those earlier reports were
overwritten by these re-recordings after small code changes, so the comparison figures
are quoted from them, not retained. Every pass criterion still held. Treat the latencies
as local observations under that load, not as capacity figures.

### Healthy default-budget baseline

All **1,440** healthy-load requests succeeded. Each row pools the three repetitions at
one concurrency level. HTTP/s is completed requests divided by their combined wave
duration. Latencies are in **milliseconds**, excluding generator queueing, warm-up and
recovery.

| Concurrency | Requests | p50 | p95 | p99 | Max | HTTP/s |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 360 | 25.587 | 78.518 | 84.127 | 108.941 | 27.70 |
| 3 | 360 | 61.290 | 183.386 | 233.237 | 276.609 | 34.72 |
| 6 | 360 | 151.062 | 292.864 | 466.319 | 598.318 | 33.89 |
| 12 | 360 | 318.170 | 441.162 | 500.041 | 653.130 | 35.35 |

### Default-budget fault outcomes

Every load request is included, grouped by outcome across the three repetitions.
Latencies are in **seconds**. In a group of fewer than 20 requests, nearest-rank p95 and
p99 equal the maximum. These are controlled-fault observations, not production tail
estimates.

| Scenario | Outcome | Count | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Pool | `pool_timeout` | 36 | 20.064 | 20.079 | 20.079 | 20.079 |
| Connect | `connect_timeout` | 22 | 20.039 | 30.053 | 30.054 | 30.054 |
| Connect | `pool_timeout` | 14 | 20.046 | 20.051 | 20.051 | 20.051 |
| Command | `pool_timeout` | 27 | 20.079 | 20.086 | 20.086 | 20.086 |
| Command | `command_timeout` | 9 | 30.127 | 30.162 | 30.162 | 30.162 |
| Half-open command | `connect_timeout` | 3 | 10.025 | 10.040 | 10.040 | 10.040 |
| Half-open command | `pool_timeout` | 24 | 20.052 | 20.062 | 20.063 | 20.063 |
| Half-open command | HTTP 200 | 3 | 20.207 | 20.216 | 20.216 | 20.216 |
| Half-open command | `command_timeout` | 3 | 32.051 | 32.090 | 32.090 | 32.090 |
| Half-open command | `checkout_timeout` | 3 | 32.051 | 32.091 | 32.091 | 32.091 |
| Idle pre-ping | HTTP 200 | 30 | 0.227 | 0.353 | 0.354 | 0.354 |
| Idle pre-ping | `checkout_timeout` | 6 | 32.057 | 32.060 | 32.060 | 32.060 |
| Cancellation | Cancelled | 18 | 0.073 | 0.085 | 0.085 | 0.085 |
| Cancellation | HTTP 200 | 18 | 0.228 | 0.294 | 0.294 | 0.294 |
| Chat short | HTTP 200 (chat requests) | 9 | 5.137 | 5.194 | 5.194 | 5.194 |
| Chat short | HTTP 200 (reads) | 36 | 5.221 | 5.383 | 5.435 | 5.435 |
| Chat long | `pool_timeout` (reads) | 36 | 20.047 | 20.063 | 20.063 | 20.063 |
| Chat long | HTTP 200 (chat requests) | 9 | 25.156 | 25.174 | 25.174 | 25.174 |
| Chat database | `pool_timeout` (chat requests) | 27 | 20.102 | 20.107 | 20.107 | 20.107 |
| Chat database | `command_timeout` (chat requests) | 9 | 30.133 | 30.137 | 30.137 | 30.137 |

The connect case shows why a 10 s connect budget is not a 10 s request deadline: a
request that first queued for a pool slot and then spent the connect budget took up to
30.054 s. Half-open faults can hit an active command and concurrent checkouts at the same
time, while fresh connections still let a few reads succeed. A half-open command or
pre-ping failure took about 32 s: one 30 s command budget, then up to 2 s for SQLAlchemy's
bounded close of the dead connection. A lock-bound command failed after about 30 s: its
cancel reached PostgreSQL at once, so closing that connection added almost nothing.

In the chat cases, three chat requests held every pool slot after their real analytics
query. With a **5 s** provider delay, all 36 accompanying reads still returned 200, but
each one waited for a slot and took 5.062–5.435 s, against a healthy p50 of 318 ms at
concurrency 12. With a **25 s** delay, all 36 reads returned pool-timeout 503s after
about 20 s, while all nine chat requests eventually succeeded. The chat requests held
their connections for 5.08–5.14 s and 25.09–25.13 s respectively. This is connection
pressure caused by a transaction staying open across provider calls, even with a
responsive database. It supports a separate transaction-lifetime and deployment
decision, not a silent increase to the pool or the budgets.

### Pool release and recovery

Every cycle returned to **zero checked-out connections** before and after recovery and
settled to at most **two open relay sockets with no leftover request task**. The counters
below are each scenario's cumulative totals, including warm-up, the harness's own
connections and recovery. Failed connects and pre-pings explain checkins without a
successful checkout. For the healthy scenario, the last column is measured from the end
of the load wave, since there is no fault.

| Scenario | Checkouts / checkins / invalidations | Envelope (s) | Max seconds from fault removal to recovery reads done |
| --- | ---: | ---: | ---: |
| Healthy | 1,600 / 1,600 / 0 | 125 | 0.4819 |
| Pool | 52 / 52 / 0 | 35 | 1.2040 |
| Connect | 52 / 68 / 9 | 45 | 0.7161 |
| Command | 52 / 52 / 9 | 125 | 0.9494 |
| Half-open command | 58 / 61 / 6 | 125 | 0.5525 |
| Idle pre-ping | 82 / 88 / 6 | 125 | 1.6357 |
| Cancellation | 70 / 70 / 9 | 125 | 0.7322 |
| Chat short | 88 / 88 / 0 | 130 | 0.8330 |
| Chat long | 52 / 52 / 0 | 150 | 0.4488 |
| Chat database | 52 / 52 / 9 | 125 | 0.5050 |

## Discard findings and the asyncpg 0.32 requirement

When a command times out, the engine discards its connection, and the question is how
that connection is closed. FP-275 shipped a pool listener that gave each discarded
connection one cleanup budget to close gracefully. It existed for asyncpg 0.30–0.31,
which `requirements.txt` then allowed: their close waits without limit for PostgreSQL to
acknowledge the cancel, which a half-open socket never does.

1. **The listener left sockets open on asyncpg 0.31.** Repeated half-open and pre-ping
   cycles on 0.31.0 returned correct HTTP responses and reported zero checked-out
   connections, yet open relay sockets grew 4 → 6 → 8 instead of settling to the two
   retained connections, and one cycle hit the watchdog. asyncpg 0.31's close sets the
   protocol's closing flag before it waits, so when the listener's timeout cancelled that
   wait, the fallback abort saw the flag and did nothing. Both failing runs are retained:
   [asyncpg-031-command-initial.json](fp-299-results/asyncpg-031-command-initial.json) and
   [asyncpg-031-ping-initial.json](fp-299-results/asyncpg-031-ping-initial.json). They were
   produced by this repository's integration test on asyncpg 0.31.0 before any fix and
   copied out of pytest's temporary folder, so their `revision` ("integration-test") and
   `dirty` (false) fields are test placeholders, not the source's real state. They were
   also written by the runner before its final refactor (source digest `f2ed1539…`), so a
   few fields differ from the final reports: `setup_watchdog_seconds` instead of
   `setup_timeout_seconds`, and no `relay_errors` or `pool.matches_code_default`.
2. **The first fix stopped PostgreSQL's cancel.** Replacing the listener with one that
   aborted the socket before any graceful close settled the sockets, but a review found
   that the abort also cancels the cancel request asyncpg has just scheduled for the
   timed-out statement. The API returned 503 while the statement kept running on the
   server, holding its locks: a `pg_sleep` backend was still active after the request had
   failed, and a lock-scenario cycle run with that listener restored left 3 statements
   waiting.
3. **Final change: require asyncpg 0.32 and remove the listener.** asyncpg 0.32 bounds its
   own close: it sends the cancel, waits for it until the deadline, then aborts the
   socket. SQLAlchemy closes a discarded connection with `close(timeout=2)`, so no custom
   listener is needed. `backend/requirements.txt` now requires `asyncpg>=0.32.0` (a shared
   file), and `app/db/engine.py` explains why there is no listener.

Verification of the final change:

- `tests/integration/test_db_timeouts.py::test_slow_command_times_out_and_discards_connection`
  now also asserts that PostgreSQL itself has stopped the timed-out statement. It passes
  on the final code and fails with the first fix's listener restored.
- All 86 FP-275 timeout and failure-propagation tests pass on asyncpg 0.32 without
  the listener, including a new check that fails if the installed asyncpg is older than
  the floor (an environment built before this change must reinstall `requirements.txt`).
- Both final profiles settle to at most two open relay sockets after every cycle, and
  every command and chat-database lock cycle (six per profile) leaves no timed-out
  statement waiting. Cancellation cycles are not measured this way; see the next section.

The cost is visible in the results. A half-open or idle-ping failure now includes up to
2 s for SQLAlchemy's bounded close (2.0–2.4 s instead of about 1.0 s in the smoke
profile), where the first fix closed the socket instantly. asyncpg 0.30–0.31 are no
longer supported, so no older-driver regression run is needed.

## A cancelled request's statement keeps waiting

Cancelling a request while its query is in flight is not the same as a timeout. In each
cancellation cycle, three of the cancelled requests are already waiting on the lock in
SQL. Each discards its connection and logs SQLAlchemy's
`ERROR ... Exception terminating connection` with a `CancelledError` traceback: the
request's cancellation interrupts SQLAlchemy's bounded close, so SQLAlchemy force-closes
the socket and re-raises the cancellation. The API side is clean. The requests end as
cancelled, the scenario records three invalidations per cycle, and every cycle returns
to zero checked-out connections and settles. These nine lines are the only application
error lines in the default-budget run's console log, which is archived with the
superseded reports.

PostgreSQL, however, is never told to cancel those statements, because the forced close
also cancels the cancel request asyncpg had scheduled. A separate probe through the same
app and harness (not part of the runner) found all three cancelled requests' backends
still waiting on the lock 2 s after the API had closed their connections, in each of
three trials. A query cancelled outside the app, directly on the engine, was cancelled
in PostgreSQL within 0.1 s. Such a statement keeps waiting, holding a server
connection, until the lock is released and it can run. The runner does not measure
this and FP-299 does not change it: it
is recorded as an open item in known issue 4. Whether a client disconnect in a
deployment cancels a request this way was not established here.

## Development runs not retained

Several development runs failed because of harness defects, not API behaviour, or were
superseded by later code. Their reports, and the final default-budget run's console log,
are archived outside the repository; only their findings are kept here:

- **Setup diagnostic:** the analytics warm-up returned no seeded driver because the
  fixture lacked the departure ledger row the view needs. The warm-up correctly refused
  to start fault injection.
- **First smoke run:** two half-open command cycles did not observe their required
  command timeout. Relay records compared by value, so removing a closed relay could
  drop an equal live record from tracking. Relays are now tracked by identity.
- **Earlier fixture initialization:** a transactional `SET search_path` was rolled back
  by the first request, and depots were missing IDs. Initialization now commits its
  private search path, and the fixture meets the current route contracts.
- **Runs with the earlier listeners:** smoke and default-budget runs on asyncpg 0.32 with
  FP-275's listener and with the first fix, and a six-cycle half-open/pre-ping run on
  asyncpg 0.31 with the first fix (the run that showed it settled the sockets), passed
  their request and recovery checks. They are superseded because the code they measured
  has changed. One pre-fix
  default-budget run also logged an `InterfaceError` when a rollback was attempted on an
  already closed connection; that log was not retained.

## Backend verification

All checks ran on the final source in the same runner image, against a disposable
PostgreSQL 17 and Redis 7 on a private Docker network, with no `.env` in the tree.

| Check | Result |
| --- | --- |
| Full backend Ruff | Pass |
| Full backend mypy | Pass; 684 source files |
| Structure ratchet (`scripts/check_structure.py`) | Pass |
| Import-linter | 17 contracts kept, 0 broken |
| FP-275 timeout, failure-propagation and asyncpg-floor tests | **86 passed** |
| FP-299 unit tests and standalone integration run | **46 passed**; the integration run took 56.81 s (about 30 s on the quieter machine earlier) |
| Full backend `pytest -m "not slow"` | **4,242 passed**, 4 skipped, 313 deselected; 1,029.66 s |
| Cold-import stage (`pytest -m slow tests/baseline/test_b7_import_cycles.py`) | **313 passed**; 131.76 s |

These durations were measured under the same heavier machine load as the final load
runs; the same full suite took 379.83 s earlier the same day.

The four skips are existing seed-fixture parameterizations covered by sibling cases. The
suite's 2,146 warnings come from elsewhere: the FP-299 and FP-275 test sets above run
without any. After pytest completes, the existing Redis client destructor can print an
`Event loop is closed` message; the process still exits successfully.

```powershell
$compose = @('--env-file', 'NUL', '-f', 'infrastructure/docker/docker-compose.load.yml')
docker compose @compose build runner
docker compose @compose up -d --wait test-db test-redis

docker compose @compose run --rm --no-deps runner ruff check .
docker compose @compose run --rm --no-deps runner mypy .
docker compose @compose run --rm --no-deps runner python scripts/check_structure.py
docker compose @compose run --rm --no-deps runner lint-imports
docker compose @compose run --rm --no-deps runner pytest tests/unit/test_db_timeouts.py tests/integration/test_db_timeouts.py tests/unit/test_db_failure_propagation.py
docker compose @compose run --rm --no-deps runner pytest tests/unit/test_load_db_timeouts.py tests/integration/test_db_timeout_load.py
docker compose @compose run --rm --no-deps runner pytest -m 'not slow'
docker compose @compose run --rm --no-deps runner pytest -m slow tests/baseline/test_b7_import_cycles.py

docker compose @compose down --volumes
```

## Interpretation boundaries

This measures timeout classification, bounded cleanup, API-side cancellation accounting
and recovery for the documented concurrent API workload. It does not show that a
cancelled request's statement is cancelled in PostgreSQL; a separate probe found it is
not (see the cancellation section and known issue 4). The in-process transport excludes deployed HTTP proxy
and network overhead. A tiny synthetic fixture on a shared local machine cannot establish
hosted Supabase/Supavisor capacity, production p99 latency or deployment-calibrated
timeout values. The chat cases deliberately test a request holding its transaction while
it waits on a provider; they support a separate transaction-lifetime decision, not a
silent increase to the pool or the budgets.

Celery tasks and the in-process anchor fallback use their own engines and need their own
measurements, as does Hedera receipt latency. In particular, the SO-1 "receipts within
60 seconds" claim cannot be derived from this run.
