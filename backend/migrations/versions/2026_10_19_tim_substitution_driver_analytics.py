"""FP-83 C7: stop the driver analytics view blaming the original driver for a later driver's work.

`driver_analytics` (tom_analytics_read_models, made a plain view by tom_live_analytics_views)
attributes every closed trip, exception and phase to `trips.driver_id`: the journey lock's
ORIGINAL driver. After a handover that counts B's exceptions and B's phase dwell against A.

This revision recreates the view so that:

- A trip that never changed driver is computed exactly as before (same rows, same numbers):
  every whole-trip metric, exception and phase goes to its one driver.
- A trip that changed driver ("shared") contributes no whole-trip metric to anyone (trip count,
  trips-with-exceptions, on-time departure): they cannot be fairly split, and counting the trip
  once per participant would double-count it. Each participant's `shared_trip_count` says so,
  so a ranking can label the excluded scope instead of silently omitting it.
- On a shared trip, an exception counts against the driver who raised it
  (exceptions.performed_by_driver_id); a system-detected one has no actor and is not attributed.
- On a shared trip, a phase counts against the driver who performed it, and dwell is measured
  only between two phases the SAME driver performed in the SAME custody period, so no dwell
  that crosses a handover is assigned to either driver. Overrides (no performing driver) on a
  shared trip are not attributed.

Unknown legacy actors stay unknown: nothing is relabelled as a verified capture.

Hand-written; the SQL is spelled out here rather than imported so this revision stays frozen.
Downgrade restores the earlier definition from tom_analytics_read_models' own SQL.

Revision ID: tim_dsub_driver_analytics
Revises: tim_dsub_anchor_index
Create Date: 2026-10-19
"""
import importlib.util
from pathlib import Path

from alembic import op

# Keep revision ids under 32 characters - alembic_version.version_num is varchar(32).
revision = "tim_dsub_driver_analytics"
down_revision = "tim_dsub_anchor_index"
branch_labels = None
depends_on = None

_TZ = "Africa/Johannesburg"
_ATTESTED = "('completed', 'exception')"
_DWELL_PHASES = ("activation", "loading", "departure", "unloading", "confirmation")

_GAP_IS_ATTESTED = (
    f"status IN {_ATTESTED} AND prev_status IN {_ATTESTED} "
    "AND completed_at IS NOT NULL AND prev_completed_at IS NOT NULL"
)
_GAP_MINUTES = "EXTRACT(EPOCH FROM (completed_at - prev_completed_at))::double precision / 60.0"

_METRIC_COLUMNS = (
    "trip_count", "trips_with_exceptions_count", "total_exceptions_count", "info_exceptions_count",
    "warning_exceptions_count", "critical_exceptions_count", "departures_with_plan_count",
    "on_time_departures_count",
    *(f"{phase}_dwell_{kind}" for phase in _DWELL_PHASES for kind in ("minutes_sum", "events_count")),
    "phase_events_count", "override_count", "shared_trip_count",
)
_FLOAT_COLUMNS = {f"{phase}_dwell_minutes_sum" for phase in _DWELL_PHASES}


def _zero(column: str) -> str:
    return f"0::double precision AS {column}" if column in _FLOAT_COLUMNS else f"0 AS {column}"


def _contribution(select_columns: dict[str, str], source: str) -> str:
    """One UNION ALL arm: the given metric expressions, zero for every other metric."""
    columns = [
        f"{select_columns[c]} AS {c}" if c in select_columns else _zero(c) for c in _METRIC_COLUMNS
    ]
    return f"SELECT operator_organization_id, driver_id, month_start, {', '.join(columns)}\n    {source}"


def _dwell(observed_extra: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for phase in _DWELL_PHASES:
        observed = f"phase_type = '{phase}' AND {_GAP_IS_ATTESTED}{observed_extra}"
        out[f"{phase}_dwell_minutes_sum"] = f"COALESCE(SUM({_GAP_MINUTES}) FILTER (WHERE {observed}), 0)::double precision"
        out[f"{phase}_dwell_events_count"] = f"(COUNT(*) FILTER (WHERE {observed}))::integer"
    return out


_TRIP_METRICS = {
    "trip_count": "COUNT(*)::integer",
    "trips_with_exceptions_count": "COUNT(te.trip_id)::integer",
    "total_exceptions_count": "COALESCE(SUM(te.total_count), 0)::integer",
    "info_exceptions_count": "COALESCE(SUM(te.info_count), 0)::integer",
    "warning_exceptions_count": "COALESCE(SUM(te.warning_count), 0)::integer",
    "critical_exceptions_count": "COALESCE(SUM(te.critical_count), 0)::integer",
    "departures_with_plan_count": "(COUNT(*) FILTER (WHERE ct.planned_departure_at IS NOT NULL))::integer",
    "on_time_departures_count": "(COUNT(*) FILTER (WHERE ct.departed_at <= ct.planned_departure_at))::integer",
}
_ACTOR_EXCEPTIONS = {
    "total_exceptions_count": "COUNT(*)::integer",
    "info_exceptions_count": "(COUNT(*) FILTER (WHERE e.severity = 'info'))::integer",
    "warning_exceptions_count": "(COUNT(*) FILTER (WHERE e.severity = 'warning'))::integer",
    "critical_exceptions_count": "(COUNT(*) FILTER (WHERE e.severity = 'critical'))::integer",
}

_DRIVER_ANALYTICS_VIEW = f"""
CREATE VIEW driver_analytics WITH (security_invoker = true) AS
WITH trip_departures AS (
    SELECT pe.trip_id, MIN(pe.completed_at) AS departed_at
    FROM phase_events pe
    WHERE pe.phase_type = 'departure' AND pe.status IN {_ATTESTED} AND pe.completed_at IS NOT NULL
    GROUP BY pe.trip_id
),
closed_trips AS (
    SELECT
        t.id AS trip_id, t.operator_organization_id, t.driver_id, t.planned_departure_at, d.departed_at,
        date_trunc('month', d.departed_at AT TIME ZONE '{_TZ}')::date AS month_start,
        EXISTS (SELECT 1 FROM driver_substitutions ds WHERE ds.trip_id = t.id) AS is_shared
    FROM trips t
    JOIN trip_departures d ON d.trip_id = t.id
    WHERE t.status = 'closed'
),
trip_exceptions AS (
    SELECT
        e.trip_id,
        COUNT(*)::integer AS total_count,
        (COUNT(*) FILTER (WHERE e.severity = 'info'))::integer AS info_count,
        (COUNT(*) FILTER (WHERE e.severity = 'warning'))::integer AS warning_count,
        (COUNT(*) FILTER (WHERE e.severity = 'critical'))::integer AS critical_count
    FROM exceptions e
    JOIN closed_trips ct ON ct.trip_id = e.trip_id
    WHERE NOT ct.is_shared
    GROUP BY e.trip_id
),
trip_phases AS (
    SELECT
        ct.operator_organization_id, ct.driver_id AS original_driver_id, ct.month_start, ct.is_shared,
        pe.phase_type, pe.status, pe.dispatcher_override_user_id, pe.completed_at,
        pe.performed_by_driver_id, pe.custody_sequence,
        LAG(pe.phase_type) OVER plan_order AS prev_phase_type,
        LAG(pe.status) OVER plan_order AS prev_status,
        LAG(pe.completed_at) OVER plan_order AS prev_completed_at,
        LAG(pe.performed_by_driver_id) OVER plan_order AS prev_performed_by_driver_id,
        LAG(pe.custody_sequence) OVER plan_order AS prev_custody_sequence
    FROM phase_events pe
    JOIN closed_trips ct ON ct.trip_id = pe.trip_id
    WINDOW plan_order AS (PARTITION BY pe.trip_id ORDER BY pe.sequence_number)
),
shared_participants AS (
    SELECT ct.operator_organization_id, ct.month_start, ct.trip_id, ct.driver_id
    FROM closed_trips ct WHERE ct.is_shared
    UNION
    SELECT ct.operator_organization_id, ct.month_start, ct.trip_id, ds.substituting_driver_id
    FROM closed_trips ct JOIN driver_substitutions ds ON ds.trip_id = ct.trip_id
    WHERE ct.is_shared
),
contributions AS (
    {_contribution(_TRIP_METRICS, '''FROM closed_trips ct
    LEFT JOIN trip_exceptions te ON te.trip_id = ct.trip_id
    WHERE NOT ct.is_shared
    GROUP BY ct.operator_organization_id, ct.driver_id, ct.month_start''')}
    UNION ALL
    {_contribution({
        **_dwell(""),
        "phase_events_count": "COUNT(*)::integer",
        "override_count": "(COUNT(*) FILTER (WHERE dispatcher_override_user_id IS NOT NULL))::integer",
    }, '''FROM (SELECT tp.*, tp.original_driver_id AS driver_id FROM trip_phases tp WHERE NOT tp.is_shared) single
    GROUP BY operator_organization_id, driver_id, month_start''')}
    UNION ALL
    {_contribution({
        **_dwell(" AND prev_performed_by_driver_id = performed_by_driver_id AND prev_custody_sequence = custody_sequence"),
        "phase_events_count": "COUNT(*)::integer",
    }, '''FROM (SELECT tp.*, tp.performed_by_driver_id AS driver_id FROM trip_phases tp
          WHERE tp.is_shared AND tp.performed_by_driver_id IS NOT NULL) shared
    GROUP BY operator_organization_id, driver_id, month_start''')}
    UNION ALL
    {_contribution(_ACTOR_EXCEPTIONS, '''FROM (SELECT ct.operator_organization_id, ct.month_start, e.performed_by_driver_id AS driver_id, e.severity
          FROM exceptions e JOIN closed_trips ct ON ct.trip_id = e.trip_id
          WHERE ct.is_shared AND e.performed_by_driver_id IS NOT NULL) e
    GROUP BY operator_organization_id, driver_id, month_start''')}
    UNION ALL
    {_contribution({"shared_trip_count": "COUNT(DISTINCT trip_id)::integer"}, '''FROM shared_participants
    GROUP BY operator_organization_id, driver_id, month_start''')}
)
SELECT
    operator_organization_id, driver_id, month_start,
    {", ".join(f"SUM({c})::{'double precision' if c in _FLOAT_COLUMNS else 'integer'} AS {c}" for c in _METRIC_COLUMNS)}
FROM contributions
GROUP BY operator_organization_id, driver_id, month_start
"""

# Recreating a view drops its REVOKE, and Supabase's default privileges grant every new public
# object to anon/authenticated: without this every operator's driver analytics would be readable
# cross-tenant through the Data API (tom_live_analytics_views' reasoning). No-op on plain Postgres.
_REVOKE_DATA_API_ACCESS = """
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON driver_analytics FROM %I', api_role);
        END IF;
    END LOOP;
END $$
"""

UPGRADE_STATEMENTS: tuple[str, ...] = ("DROP VIEW driver_analytics", _DRIVER_ANALYTICS_VIEW, _REVOKE_DATA_API_ACCESS)


def _previous_definition() -> str:
    """The pre-FP-83 view: tom_analytics_read_models' SQL, as the plain view tom_live made it."""
    path = Path(__file__).with_name("2026_09_12_tom_analytics_read_models.py")
    spec = importlib.util.spec_from_file_location("tom_analytics_read_models_for_downgrade", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._DRIVER_ANALYTICS.replace(
        "CREATE MATERIALIZED VIEW driver_analytics AS",
        "CREATE VIEW driver_analytics WITH (security_invoker = true) AS",
    )


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP VIEW driver_analytics")
    op.execute(_previous_definition())
    op.execute(_REVOKE_DATA_API_ACCESS)
