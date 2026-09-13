"""Live analytics: the five analytics views become plain views instead of materialized ones

Revision ID: tom_live_analytics_views
Revises: tom_trailer_vehicle_analytics
Create Date: 2026-09-13

FP-153 built the analytics read models as materialized views: a stored snapshot that only
changes when something runs REFRESH. The refresh was left to a Celery beat schedule, and
this team runs the app only on developer laptops, so nothing was ever running it. The
snapshot froze and newly closed trips never appeared on the analytics screen
(docs/design-notes/2026-09-13-live-analytics-views.md).

Measured on the shared database before this change: computing all five views live costs
2.7 ms of database work in total, against a ~166 ms network round trip that every page load
pays either way. A stored snapshot saves nothing a dispatcher could notice, so each view
becomes a plain view: worked out from the evidence tables on every read, never stale, and
with nothing to schedule.

How: Postgres has no ALTER that turns a materialized view into a plain one, so each is
dropped and recreated. The recreated view's SQL is read back from the catalog instead of
being copied into this file. That SQL is already frozen in tom_analytics_read_models and
tom_trailer_vehicle_analytics. This migration only changes how the result is stored, and
reading the stored definition means the numbers cannot drift from what those two defined.
INTO STRICT makes a missing view fail the migration loudly instead of being skipped.

security_invoker: by default a plain view reads its tables with its OWNER's rights, which
would bypass the RLS policies on trips, phase_events and exceptions for any role allowed to
read the view. security_invoker makes it read them with the CALLER's rights instead, the
setting Supabase recommends for views. The backend's own role bypasses RLS, so its results
are unchanged.

A plain view has no index, so the unique indexes that REFRESH ... CONCURRENTLY needed go
with the materialized views. The downgrade rebuilds them.

As FP-153 §11.8 #2 warns, a later migration that alters or drops a column these views read
must drop and recreate them: Postgres tracks that dependency for plain views too.

Tests load UPGRADE_STATEMENTS and DOWNGRADE_STATEMENTS from this module, so the SQL under
test is the SQL shipped.
"""

from alembic import op

revision = "tom_live_analytics_views"
down_revision = "tom_trailer_vehicle_analytics"
branch_labels = None
depends_on = None

# Each view's grain: the columns that identify one row. Only the downgrade uses them, to
# rebuild the unique index REFRESH MATERIALIZED VIEW CONCURRENTLY refuses to run without.
_VIEW_GRAINS: dict[str, tuple[str, ...]] = {
    "driver_analytics": ("operator_organization_id", "driver_id", "month_start"),
    "vehicle_analytics": ("operator_organization_id", "vehicle_id", "month_start"),
    "vehicle_incident_streaks": ("operator_organization_id", "vehicle_id"),
    "lane_analytics": (
        "operator_organization_id", "origin_precinct_id", "destination_precinct_id", "month_start",
    ),
    "facility_analytics": ("operator_organization_id", "precinct_id", "month_start"),
}

# The catalog stores a view's query with a trailing semicolon (and sometimes whitespace).
# CREATE ... AS must end at the query, so those are trimmed before it is reused.
_TRIM_QUERY_END = r"E'; \n'"


def _to_plain_view(view: str) -> str:
    return f"""
DO $$
DECLARE
    view_query text;
BEGIN
    SELECT definition INTO STRICT view_query
    FROM pg_matviews
    WHERE schemaname = current_schema() AND matviewname = '{view}';
    EXECUTE 'DROP MATERIALIZED VIEW {view}';
    EXECUTE 'CREATE VIEW {view} WITH (security_invoker = true) AS '
        || rtrim(view_query, {_TRIM_QUERY_END});
END $$
"""


def _to_materialized_view(view: str) -> str:
    # CREATE MATERIALIZED VIEW defaults to WITH DATA, so the snapshot is filled on creation.
    return f"""
DO $$
DECLARE
    view_query text;
BEGIN
    SELECT definition INTO STRICT view_query
    FROM pg_views
    WHERE schemaname = current_schema() AND viewname = '{view}';
    EXECUTE 'DROP VIEW {view}';
    EXECUTE 'CREATE MATERIALIZED VIEW {view} AS ' || rtrim(view_query, {_TRIM_QUERY_END});
END $$
"""


_UNIQUE_INDEXES: tuple[str, ...] = tuple(
    f"CREATE UNIQUE INDEX uq_{view}_grain ON {view} ({', '.join(columns)})"
    for view, columns in _VIEW_GRAINS.items()
)

# Recreated views lose the earlier REVOKE, and Supabase's default privileges grant every
# new public object to anon/authenticated. Without this, every operator's analytics would
# be readable cross-tenant through the Data API. Guarded on the roles existing, so it is a
# no-op on plain Postgres (the test database, a local instance).
_REVOKE_DATA_API_ACCESS = f"""
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON {", ".join(_VIEW_GRAINS)} FROM %I', api_role);
        END IF;
    END LOOP;
END $$
"""

UPGRADE_STATEMENTS: tuple[str, ...] = (
    *(_to_plain_view(view) for view in _VIEW_GRAINS),
    _REVOKE_DATA_API_ACCESS,
)

DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    *(_to_materialized_view(view) for view in _VIEW_GRAINS),
    *_UNIQUE_INDEXES,
    _REVOKE_DATA_API_ACCESS,
)


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
