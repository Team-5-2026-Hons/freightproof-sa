# Alembic autogenerate drift — what it was, how it was fixed, what is still open

**Date:** 2026-09-15 · **Status:** ✅ FIXED — 28 operations reduced to 0 · **Applies to:** every developer

---

## Status: fixed

Autogenerate used to emit **28 operations nobody asked for** on every run, including two
that would have broken authentication system-wide. As of 2026-09-15 it emits **none** —
a fresh `alembic revision --autogenerate` now produces only the change you actually made.

Keep reading anyway if you are about to write a migration: the pruning discipline in
"The procedure" below still applies, because nothing stops drift returning, and **CI still
does not verify migrations** (see "Still open").

## How to see it for yourself

```bash
cd backend && .venv/bin/alembic check
```

This is read-only — it compares the models against the database and reports the diff
without writing a file. It currently FAILS with the 28 operations below. That failure is
the expected state today, not a sign you broke something.

## What gets emitted, worst first

### 🔴 Two foreign keys to Supabase Auth — these are the dangerous ones

```
remove_fk  fk_users_auth_id      users.id   -> auth.users.id   ON DELETE CASCADE
remove_fk  fk_drivers_auth_id    drivers.id -> auth.users.id   ON DELETE CASCADE
```

These are the links installed by migration `0003 — Switch users and drivers to Supabase
Auth identity`. Dropping them severs every user and driver row from their Supabase Auth
identity. **If one of these reaches a real upgrade, authentication is broken and the
relationship cannot be rebuilt from data we still hold.**

Why autogenerate wants to drop them: they point at `auth.users`, which lives in Supabase's
`auth` schema. Our `Base.metadata` does not include that schema, so autogenerate sees a
foreign key to a table it has never heard of and concludes it is stale.

### 🟠 Twenty-one indexes

```
ix_blockchain_receipts_subject          ix_blockchain_receipts_trip_type
ix_checkpoints_trip_created             ix_driver_events_driver_id
ix_driver_substitutions_trip_id         ix_exceptions_severity
ix_exceptions_trip_review_status        ix_handover_capability_tokens_phase_event
ix_handover_confirmations_trip_id       ix_handover_token_attempts_token_id
ix_parcels_barcode                      ix_parcels_consignment_id
ix_precinct_events_precinct_id          ix_trips_created_at_desc
ix_trips_driver_id                      ix_trips_order_number
ix_trips_org_status_closed_id           ix_trips_status
ix_vehicle_events_vehicle_id            ix_vehicles_vin_number
uq_handover_capability_tokens_token_hash
```

These exist in the database because a migration created them with `op.create_index(...)`,
but the corresponding model never declared a matching `Index()` in `__table_args__`.
Autogenerate only knows what the models declare, so it reads every one of them as stale.

Dropping them does not lose data, but it does silently remove the indexes the trip list,
the exception queue and the analytics views depend on. The symptom is a system that still
works and gets progressively slower for reasons nobody can find.

### 🟡 Five constraint churn operations

```
add_fk          fk_driver_events_blockchain_receipt
add_fk          fk_driver_sub_blockchain_receipt
add_fk          fk_vehicle_events_blockchain_receipt
add_constraint  unique(token_hash)   on handover_capability_tokens
add_constraint  unique(vin_number)   on vehicles
```

The two `add_constraint`s pair with `remove_index` entries above — autogenerate wants to
convert a unique *index* into a unique *constraint*. Functionally near-identical, churn for
no benefit, and the drop half runs first.

## The procedure — follow it every time

1. **Before generating**, check for unmerged migrations (already in `CLAUDE.md`):
   ```bash
   git fetch origin && git log --oneline HEAD..origin/dev -- backend/migrations/versions/
   ```
   Any output ⇒ stop and rebase. Do not repair a revision chain alone.

2. **Confirm a single head.** More than one means the chain has forked:
   ```bash
   cd backend && .venv/bin/alembic heads
   ```

3. Generate, then **rename** to `YYYY_MM_DD_<yourname>_<what>.py`.

4. **Read the generated file end to end and DELETE everything that is not the change you
   intended** — in `upgrade()` *and* `downgrade()`. Do not skim. Do not assume a short file
   is clean.

5. **Prove what survived:**
   ```bash
   grep -nE "op\.[a-z_]+\(" backend/migrations/versions/<yourfile>.py
   ```
   Every line printed must be an operation you can explain. If you see a table you did not
   touch, you have drift.

6. **Never run `alembic upgrade` against `DATABASE_URL` casually.** It points at the
   **shared Supabase dev database**. Apply from `dev` after merge, not from a feature
   branch — the database records one `alembic_version`, and stamping it with a revision
   that exists only on your branch breaks alembic for everyone else until you merge.

## Why this has not bitten anyone yet

Pure luck and small migrations. Recent ones were reviewed by hand and pruned. The exposure
grows every time someone generates a migration in a hurry.

`tests/conftest.py` builds schema with `Base.metadata.create_all`, not Alembic, so **the
entire test suite passes against a schema Alembic never produced.** Green tests say nothing
about migration correctness. That is the gap CI leaves open.

## What was done

1. **`include_object` filter in `migrations/env.py`.** `fk_users_auth_id` and
   `fk_drivers_auth_id` are excluded from autogenerate by name. They point at
   `auth.users`, a table in Supabase's schema that `Base.metadata` does not model, so
   autogenerate read them as stale. Excluded by name rather than by schema, deliberately —
   a genuinely stale FK on any other table is still reported. Killed the two 🔴 operations.

2. **Twenty-one indexes declared on the models.** Added to `__table_args__` across
   `blockchain.py`, `transit.py`, `events.py`, `trips.py`, `handover.py` and `vehicles.py`,
   matching the database's own DDL exactly. Two needed conversion rather than addition:
   `uq_handover_capability_tokens_token_hash` was a `UniqueConstraint` in the model but a
   unique *index* in the database, and `vehicles.vin_number` carried a column-level
   `unique=True` that made `create_all` emit `vehicles_vin_number_key` instead of the
   deployed `ix_vehicles_vin_number`. Both now declare the index explicitly. Killed the
   🟠 block and both 🟡 `add_constraint`s.

   Side benefit: `Base.metadata.create_all` now produces these indexes too, so the test
   schema is closer to production than it was.

3. **The three missing foreign keys were real.** `fk_driver_events_blockchain_receipt`,
   `fk_driver_sub_blockchain_receipt` and `fk_vehicle_events_blockchain_receipt` are
   declared by the models but absent from the database — the drift pointed the other way,
   and three tables could hold a `blockchain_receipt_id` referencing a receipt that does
   not exist. `fk_precinct_events_blockchain_receipt` exists, so a past migration added
   some and not others. Checked for orphan rows first (0 across all three), then closed
   with `2026_09_15_tim_close_blockchain_receipt_fk_drift.py`.

Verified: `1542 passed, 0 failed` before and after — no regression. A fresh autogenerate
after all three now emits an empty migration.

## Still open

**CI still cannot verify migrations, and this turned out to be why.** The intended check —
apply the chain to a scratch database, then `alembic check` — does not work on a plain
PostgreSQL runner. The chain is Supabase-coupled at three points, each discovered by
hitting it:

| Migration | Needs |
|---|---|
| `0003` | schema `auth` and table `auth.users` |
| `0004` (RLS) | functions `auth.jwt()`, and by extension `auth.uid()` / `auth.role()` |
| `tom_live_analytics_views` | PostgreSQL **15+** for `security_invoker` (local dev is 14.18) |

Stubbing the first two is straightforward; the third needs a newer Postgres in CI. Until
someone does both, **no test anywhere proves a migration applies.** `tests/conftest.py`
builds schema with `Base.metadata.create_all`, so a full green suite says nothing about
the migration chain. That is a separate ticket.

Until CI covers it: **read every generated migration before committing it.**

## For anyone using Claude Code on this repo

Point your session at this file before asking it to generate a migration. An agent that has
not read this will produce a file that looks correct, passes every test, and drops two
foreign keys and twenty-one indexes.
