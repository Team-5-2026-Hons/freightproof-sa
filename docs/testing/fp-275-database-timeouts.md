# FP-275 — API database timeout handling

The API engine uses explicit, configurable asyncpg and SQLAlchemy budgets. A known
database availability failure becomes HTTP **503** with
`{"detail":"Database temporarily unavailable."}`. Other SQL/application errors
retain their existing handling, including their existing log messages. The optional
Parcel Perfect assignment hint retains its existing advisory fallback.

## Configuration

| Setting | Default (seconds) | Applies to |
| --- | ---: | --- |
| `DB_CONNECT_TIMEOUT_SECONDS` | 10 | Opening a new database connection |
| `DB_POOL_TIMEOUT_SECONDS` | 20 | Waiting for a pool slot |
| `DB_COMMAND_TIMEOUT_SECONDS` | 30 | Driver commands, including pre-ping/transaction commands |
| `DB_CLEANUP_TIMEOUT_SECONDS` | 5 | Each session rollback or close (a discarded connection's close has SQLAlchemy's own 2 s limit) |

All values must be positive and finite. An omitted or blank setting uses its default.
The defaults are **provisional operating budgets, not measured Supabase p99 values**.
Measure normal connection, checkout and command times in the representative deployment
before tuning them. The [FP-299 report](fp-299-database-timeout-load.md) records the
separate local concurrent-load evidence and the asyncpg 0.32 requirement that came out of it.

Calibration rules that follow from the code, not from measurement:

- **Pool wait must outlast the longest normal connection hold.** Trip creation and
  audit-pack issue keep their connection through a synchronous Hedera submit
  (`HEDERA_SUBMIT_TIMEOUT_SECONDS`, 15 s) or Parcel Perfect calls (15 s each). With a pool
  of 2 + 1 per instance, a shorter wait turns ordinary concurrency on a healthy database
  into 503s. That is why the default is 20 s, not a tighter guess.
- **The command budget also bounds lock waits.** A statement that waits longer than
  `DB_COMMAND_TIMEOUT_SECONDS` for a row lock is reported as `reason=command_timeout`,
  even though the database is healthy. Audit-pack issue holds `FOR UPDATE` on its trip
  through the PDF render, the storage upload and the Hedera seal, so a concurrent phase
  completion on the same trip can wait behind it.
- **Pre-ping detection costs one command budget.** A silently dropped idle connection is
  found only when its ping times out. `pool_recycle` was considered and not adopted: no
  measured deployment idle cutoff exists to size it from. FP-299 injects silence
  deliberately; it does not measure the hosted pooler's cutoff.

These are per-operation limits. A request can wait for a pool slot, perform a connection
check/reconnect, execute multiple commands, and clean up. Rollback and close each have
their own cleanup budget, and closing a discarded connection can add SQLAlchemy's fixed
2 s close limit. SQLAlchemy can also retry a stale connection during checkout.
Do not describe the largest single setting as an end-to-end HTTP deadline.

## Behaviour

- Connection establishment and pool checkout classify errors at the database boundary;
  unrelated network or partner timeouts are not misreported as database faults.
- A refused connection, a DNS failure, a server shutdown/startup SQLSTATE, or a lost
  connection is `reason=connection_unavailable`. Postgres `too_many_connections` and
  Supabase Supavisor's capacity refusals at connect time (`EMAXCONN*`,
  `ECHECKOUTTIMEOUT`, sent as SQLSTATE `XX000`) are `reason=server_capacity`. Any other
  `XX000` keeps its ordinary 500 handling.
- The SQLAlchemy error hook discards a connection on a timed-out/failed DB operation.
  Normal stale-connection detection retains SQLAlchemy's reconnect behaviour.
- SQLAlchemy closes a discarded connection with `close(timeout=2)`. On asyncpg 0.32+ (the
  `requirements.txt` floor since FP-299) that close first sends PostgreSQL's cancel for a
  timed-out statement, then aborts the socket at the deadline. A half-open connection
  therefore cannot hang, and the statement also stops on the server instead of running
  on, holding its locks, after the 503. FP-275 originally added a listener to bound this
  close on asyncpg 0.30–0.31. FP-299 found that it could leave sockets open on 0.31, and
  that aborting the socket first instead skips the server-side cancel, so the floor was
  raised and the listener removed. See the
  [FP-299 findings](fp-299-database-timeout-load.md#discard-findings-and-the-asyncpg-032-requirement).
- Session rollback and close are bounded, including explicit service-side rollbacks.
  `get_db` and service/endpoint error handlers log a rollback failure without masking
  the original request error. A consignment conflict therefore keeps its 409 mapping
  even when cleanup stalls. Cancellation still propagates. Recovery handlers that
  need another query proceed only after a successful rollback.
- Optional phase/checkpoint corroboration, findings, receiver verification and report
  assessments propagate `DatabaseUnavailableError`. A failed transaction cannot save
  the underlying evidence, so swallowing the outage would only replace its 503 with a
  later `PendingRollbackError` and generic 500. Other optional-work failures retain
  their existing fail-open handling.
- The API log records the failure reason, operation, route template and configured
  budgets. It does not copy raw driver messages, SQL parameters or capability tokens.
- A write is never automatically replayed. A lost commit acknowledgement can leave its
  outcome uncertain; 503 does not promise that an earlier commit did not take effect.
- The API engine and its session factory own this policy. Celery tasks and Alembic
  currently construct their own engines and have separate lifecycle/configuration.

## Engine coverage

- **In-process anchor fallback.** When the Celery broker is unreachable, phase and evidence
  anchoring run the task engine inside the API process. That engine has asyncpg's 60 s
  connect default and no command timeout. No request waits on it.

## Focused verification

Use the disposable database from `infrastructure/docker/docker-compose.test.yml`, with
`TEST_DATABASE_URL` explicitly targeting its `freightproof_test` database. Tests never
fall back to `DATABASE_URL`. Run from `backend/`:

```text
pytest tests/unit/test_db_timeouts.py tests/integration/test_db_timeouts.py
pytest tests/unit/test_db_failure_propagation.py
pytest tests/unit/test_db_session_pool.py tests/unit/test_health_probes.py tests/integration/test_health.py
pytest tests/integration/test_handover_endpoints.py tests/integration/test_receiver_verification_endpoints.py
pytest tests/unit/test_phase_meta_contract.py
```

The tests exercise:

- a real stalled TCP handshake and a real refused connection;
- a real exhausted SQLAlchemy pool and a real timed-out PostgreSQL command, which the
  server must also have cancelled;
- a real half-open connection (a local relay that stops forwarding), for both a command
  and the pre-ping;
- recovery, and API responses for every endpoint that maps SQL errors;
- cleanup and cancellation;
- a real timed-out query inside optional phase work, its structured 503 log and pool recovery;
- a real stalled service rollback preserving the original conflict;
- availability propagation through all seven optional-work handlers, plus retention of
  optional-work fallbacks and the original handover SQL-error messages.

The pre-ping classification case with an injected `TimeoutError` checks labelling only;
the half-open relay test is the real pre-ping check. A watchdog expiring fails the test
and is not counted as proof that the application timeout fired.

The shared TypeScript constants must be present at
`frontend/shared/lib/constants/phase-meta.ts` when running the backend contract tests.
For the full suite, use the same disposable database and an isolated Redis, then run
the two CI stages from `backend/`:

```text
pytest -m "not slow"
pytest -m slow tests/baseline/test_b7_import_cycles.py
```

FP-299 is the repeatable concurrent-load test and measured results report. These
focused checks establish mechanisms, not capacity or deployment latency claims.

## Historical FP-275 verification run — 20 October 2026

The results below describe the original FP-275 source and dependency snapshot, including
its since-removed discard listener. For the merged `Chiko` baseline, the asyncpg 0.32
requirement and the measured load results, see the
[FP-299 verification report](fp-299-database-timeout-load.md).

Base commit: `d16c9287` (`origin/dev`), with the FP-275 working-tree changes.
Tests ran in a Linux container using Python 3.13.16, SQLAlchemy 2.0.55, asyncpg 0.32.0,
and pytest 8.4.2, against the disposable Postgres 17 compose service. The test tree
contained no `.env`; all connection settings targeted disposable local services.

| Check | Result |
| --- | --- |
| All nine focused/regression modules listed above | **174 passed**, 25.78 seconds |
| Final review: focused checks plus API contract, PP, trip/consignment and corroboration regressions | **272 passed**, 44.96 seconds |
| Full backend suite (`-m "not slow"`), real Redis, isolated database | **3,715 passed**, 4 skipped, 1 failed (pre-existing, see below) |
| Cold-import suite (`tests/baseline/test_b7_import_cycles.py`) | **280 passed**, 131.26 seconds |
| Ruff on FP-275 Python files | Pass |
| Focused mypy on four database modules and three test modules | Pass, 7 files |
| Import-linter architectural contracts | Pass, 17 kept / 0 broken |
| Full backend Ruff | 1 existing `PLR0915` failure in `orchestration/verification/phase_payloads.py` |
| Structure ratchet | 9 violations; failure list identical to untouched `d16c9287` |
| Full backend `mypy .` | 103 existing errors in 10 unchanged files; checked 602 files |
| `git diff --check` | Pass |

The full-suite failure, `test_driver_substitution_availability.py::test_open_ended_trip_keeps_the_reservation_open_ended`,
fails identically on an untouched archive of `d16c9287`, so it is not an FP-275 regression.
The OpenAPI contract snapshot (`tests/baseline/test_b1_api_contract.py`) passes: the
handover token endpoint keeps its original docstring, which is its published description.

The Ruff and structure failures were also reproduced from an untouched archive of
`d16c9287`. The structure comparison includes the existing handover file-size failure
(466-line recorded limit; 486 on both `d16c9287` and the reviewed working tree). The
final cleanup only joins two keyword-argument lines; its AST and published endpoint
docstrings are unchanged. These are repository-wide validation blockers, so the
checks above are not a claim that all CI checks are green.
The complete mypy diagnostic list is identical to the earlier complete run; all 10
files containing errors are unchanged from the untouched `d16c9287` archive. No error
is reported in an FP-275 file.

Earlier verification is superseded by this final run: the initial suite was interrupted,
and the subsequent run had two failures because the isolated tree omitted the shared
TypeScript constants. Both contract checks now pass in the focused run. The final
snapshot includes that file, the review fixes and their regression tests.

The cold-import JUnit result is retained locally as
`%LOCALAPPDATA%\Temp\opencode\fp275-final-results\imports.xml`. The first full-suite
attempt (container `fp275-final-main`) never wrote `main.xml`: it hung in
`test_realtime_transactions.py`'s `_settle()` loop, waiting on a realtime publish task
left pending by an earlier test. The same test order on the same tree, with a real Redis
and an isolated database, completed without hanging. That points to the environment (a
host sleep mid-run), not to FP-275, but it is not proven. The full-suite row above
comes from that later run.

## Change inventory

Modified application files (relative to `backend/`):

```text
app/core/config.py
app/db/session.py
app/main.py
app/api/v1/endpoints/audit_packs.py
app/api/v1/endpoints/handover.py
app/api/v1/endpoints/phases.py
app/api/v1/endpoints/pp.py
app/api/v1/endpoints/trip_admin.py
app/api/v1/endpoints/trips.py
app/orchestration/consignments/sync.py
app/orchestration/evidence/corroboration.py
app/orchestration/exceptions/creation.py
app/orchestration/handover/receiver_verification.py
app/orchestration/phases/completion.py
app/orchestration/phases/findings.py
app/orchestration/trips/creation.py
```

Added application/test files (relative to `backend/`):

```text
app/db/cleanup.py
app/db/engine.py
app/db/errors.py
tests/unit/test_db_timeouts.py
tests/unit/test_db_failure_propagation.py
tests/integration/test_db_timeouts.py
```

Also updated `backend/.env.example` and `docs/known-issues.md`, and added this report.
The unused `api/v1/database_errors.py` from the earlier implementation was removed;
handover keeps its existing log messages and uses the shared rollback helper.

Shared configuration files: `backend/app/core/config.py` and `backend/app/main.py`.
The four optional environment keys are listed in the configuration table. No migration
or dependency change is required. (FP-275 itself needed none; FP-299 later raised the
asyncpg floor to 0.32 in `requirements.txt`, see the [FP-299 report](fp-299-database-timeout-load.md).)
