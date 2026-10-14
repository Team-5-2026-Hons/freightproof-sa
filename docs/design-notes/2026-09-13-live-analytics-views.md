# Live analytics views — decision record

Author: Tom (Thomas Davis) · 2026-09-13 · Branch `fix/analytics-live-views`
Migration: `tom_live_analytics_views` (revises `tim_handover_confirm`, FP-155's migration,
which merged to `dev` first from the same parent)

## 1. The problem

More trips closed on 2026-09-13, and the analytics screen didn't change.

The five analytics relations (`driver_analytics`, `vehicle_analytics`,
`vehicle_incident_streaks`, `lane_analytics`, `facility_analytics`) were **materialized
views**: stored snapshots that only change when something runs `REFRESH`. The only thing
that ran it was a Celery beat schedule (`app/tasks/analytics.py`, every 900 s), and beat
ran nowhere:

- the Compose `worker` starts `celery -A app.tasks worker` with no `-B` and there's no beat service,
- the app isn't hosted anywhere, it only runs on developer laptops,
- developers run Redis only, with no worker at all.

The last refresh was the manual one during the trailer-analytics post-apply checks on
2026-09-12. The FP-153 and FP-156 specs flagged this gap. It went unnoticed because that
manual refresh made everything look correct until new trips closed.

**Evidence** (read-only, shared database, 2026-09-13): 15 closed trips with an attested
departure in the base tables, against 13 in `driver_analytics`. The two missing trips were
the two closed that morning.

## 2. Options considered

| | Option | What it needs |
|---|---|---|
| **A** | Plain (live) views, worked out on every read | One migration; delete the refresh code |
| B | Keep materialized views and refresh them on trip close, on a 15-min beat backstop, and from a "Refresh now" button with a "last updated" label | A worker and beat running somewhere always on, a new endpoint, a cooldown, and storage for the last-refresh time |

## 3. Decision: A

Measured with `EXPLAIN ANALYZE` on each view's own SQL, on the shared database:

| | Time |
|---|---|
| Database work for **all five** views, computed live | **2.7 ms** |
| Network round trip to Supabase (paid by every page load either way) | ~166 ms |

A stored snapshot saves about 3 ms per page load, which no dispatcher could notice. In
return it costs stale figures and a scheduler that must always be running, and this team
has nowhere to run one. The usual practice is to compute live, measure, and add a
stored copy only when a measured need appears. The measurement shows no such need.

## 4. What changed

- **Migration** `2026_09_13_tom_live_analytics_views.py`. For each view it reads the stored
  query from `pg_matviews`, drops the materialized view, and creates
  `CREATE VIEW … WITH (security_invoker = true) AS <same query>`. It then re-runs the
  guarded `REVOKE` from `anon`/`authenticated`. The downgrade does the reverse from
  `pg_views` and rebuilds the five `uq_<view>_grain` indexes.
  - *Why read the catalog instead of copying the SQL:* the SQL is already frozen in
    `tom_analytics_read_models` and `tom_trailer_vehicle_analytics`. This migration only
    changes how the result is stored, so the numbers can't drift from what those defined.
  - *Why `security_invoker`:* a plain view normally reads its tables with its owner's
    rights, which would bypass the RLS on `trips`, `phase_events` and `exceptions` for any
    role allowed to read the view. `security_invoker` uses the caller's rights instead;
    Supabase recommends it for views. The backend role bypasses RLS, so its results
    are unchanged.
  - *Why re-`REVOKE`:* Supabase grants every new public object to `anon`/`authenticated`.
    Without the revoke, every operator's analytics would be readable across tenants through
    the Data API.
- **Removed:** `app/analytics/refresh.py`, `app/tasks/analytics.py`, the
  `analytics-refresh-views` beat entry, `ANALYTICS_REFRESH_INTERVAL_SECONDS` (from
  `config.py` and `.env.example`), and `tests/unit/test_analytics_task.py`. `config.py` has
  `extra="ignore"`, so a leftover key in anyone's `.env` is harmless.
- **Unchanged:** the read layer, the API and every response shape, because the views keep
  the same names and columns.
- **Dispatcher:** the `scopeNote` no longer says a closed trip "may take a while to appear".
- **Tests:** the view fixtures also run this migration. Tests flush instead of refreshing.
  New tests cover plain `security_invoker` views, the downgrade back to materialized
  views, and a closed trip appearing on the next request with no refresh.

## 5. When to revisit

Every read recomputes all operators' closed trips. The shared `closed_trips` CTE is
referenced several times, so Postgres works it out once per query instead of pushing the
organisation filter into it. The cost therefore grows with the total number of closed
trips. If analytics requests ever become slow at real-world volume, measure again. The
options then are indexing the base tables for the CTE, or returning to materialized views
with a scheduler on an always-on host.

## 6. Superseded

This supersedes the refresh and Celery-beat parts of the FP-153 spec (§11 refresh task),
the FP-156 spec (§0 #8 and #19, §6.1 #1, §8.7 #2) and the trailer-analytics spec. Those are
dated build records and are left as written.

## 7. Applying to the shared database

Apply once, after the PR merges to `dev` and Tom says "go": `alembic upgrade head`. Then
run these checks:

1. All five views have `pg_class.relkind = 'v'` and `reloptions` contains `security_invoker=true`.
2. `anon`/`authenticated` have no grants on them (`information_schema.role_table_grants`).
3. `SUM(trip_count)` from `driver_analytics` equals the live closed-trip count.
4. In the browser, close a trip, reload `/analytics`, and check that it appears.

Nobody else runs anything; teammates only pull `dev`.
