"""Trailer analytics: the two vehicle views cover horses and trailers

Revision ID: tom_trailer_vehicle_analytics
Revises: tom_add_exception_vehicle
Create Date: 2026-09-12

FP-153 built vehicle_analytics and vehicle_incident_streaks for horses only. This extends
both to trailers, with each breakdown counted only for the vehicle it belongs to
(docs/design-notes/2026-09-12-trailer-analytics-spec.md, Stage 2). A materialized view
cannot be altered, so both are dropped and recreated. Their output columns are
unchanged, so the read layer, the rollup and the refresh task need no change. The
driver, lane and facility views are not touched.

Attribution rules (spec §6.1):
  1. Vehicle rows: every closed trip gives one row for its horse, plus one row per
     trailer in trip_trailers.
  2. Trip count and driving hours are credited to every vehicle row of the trip.
     trip_trailers is written only at trip creation and never changes, so every trailer
     on a trip really travelled every leg of it.
  3. A mechanical exception counts for a vehicle when exceptions.vehicle_id is that
     vehicle, OR vehicle_id is NULL and that vehicle is the trip's horse. NULL is every
     breakdown from before drivers were asked "truck or trailer", and every report from
     an app that doesn't ask. Those keep counting for the horse exactly as before (spec
     decision 2).
  4. The grain stays unique. Trip creation looks the horse up as a horse and each
     trailer as a trailer, so one vehicle can't be both on the same trip, and
     trip_trailers' primary key stops a trailer appearing twice.

Hand-written: autogenerate has no notion of a materialized view. Self-contained: the
shared SQL fragments are copied from tom_analytics_read_models, not imported, because a
migration is a frozen record. DOWNGRADE_STATEMENTS restore FP-153's horse-only views from
a frozen copy of their SQL. Tests load UPGRADE_STATEMENTS and DOWNGRADE_STATEMENTS from
this module, so the SQL under test is the SQL shipped.

These views now also read trip_trailers and exceptions.vehicle_id. As FP-153 §11.8 #2
warns for its own columns, a later migration that alters or drops either column must
drop and recreate these views.
"""

from alembic import op

revision = "tom_trailer_vehicle_analytics"
down_revision = "tom_add_exception_vehicle"
branch_labels = None
depends_on = None

# ── Copied from tom_analytics_read_models (frozen there; see module docstring) ──

_OPERATIONS_TIME_ZONE = "Africa/Johannesburg"

_ATTESTED_STATUSES = "('completed', 'exception')"

_CLOSED_TRIPS_CTE = f"""
trip_departures AS (
    SELECT pe.trip_id, MIN(pe.completed_at) AS departed_at
    FROM phase_events pe
    WHERE pe.phase_type = 'departure'
      AND pe.status IN {_ATTESTED_STATUSES}
      AND pe.completed_at IS NOT NULL
    GROUP BY pe.trip_id
),
closed_trips AS (
    SELECT
        t.id AS trip_id,
        t.operator_organization_id,
        t.driver_id,
        t.horse_id,
        t.origin_precinct_id,
        t.destination_precinct_id,
        t.planned_departure_at,
        t.planned_arrival_at,
        t.actual_arrival_at,
        d.departed_at,
        date_trunc('month', d.departed_at AT TIME ZONE '{_OPERATIONS_TIME_ZONE}')::date AS month_start
    FROM trips t
    JOIN trip_departures d ON d.trip_id = t.id
    WHERE t.status = 'closed'
)"""

# A gap between two phases is only a real measurement when BOTH ends were attested.
_GAP_IS_ATTESTED = (
    f"status IN {_ATTESTED_STATUSES} AND prev_status IN {_ATTESTED_STATUSES} "
    "AND completed_at IS NOT NULL AND prev_completed_at IS NOT NULL"
)
_GAP_HOURS = "EXTRACT(EPOCH FROM (completed_at - prev_completed_at))::double precision / 3600.0"

# ── New shared fragments ─────────────────────────────────────────────────────

# FP-153's trip_phases, keyed by trip instead of by horse: driving hours are now worked
# out per trip first and then credited to every vehicle on it (rule 2), which needs
# trip_id. The window is FP-153's, unchanged. LAG runs over EVERY phase row of the trip,
# trip_creation included, partitioned by trip and ordered by sequence_number, so the
# "previous phase" is always the true previous plan step. The join to closed_trips keeps
# or drops a trip whole. Every row filter (in_transit, departure, attested) is applied
# AFTER the window, in the CTE that reads this one.
_TRIP_PHASES_CTE = """
trip_phases AS (
    SELECT
        pe.trip_id,
        pe.phase_type,
        pe.status,
        pe.completed_at,
        LAG(pe.phase_type) OVER plan_order AS prev_phase_type,
        LAG(pe.status) OVER plan_order AS prev_status,
        LAG(pe.completed_at) OVER plan_order AS prev_completed_at
    FROM phase_events pe
    JOIN closed_trips ct ON ct.trip_id = pe.trip_id
    WINDOW plan_order AS (PARTITION BY pe.trip_id ORDER BY pe.sequence_number)
)"""

# Rule 1: one row for the trip's horse, plus one row per trailer on it.
_VEHICLE_TRIPS_CTE = """
vehicle_trips AS (
    SELECT
        ct.trip_id,
        ct.operator_organization_id,
        ct.month_start,
        ct.departed_at,
        ct.horse_id AS vehicle_id,
        TRUE AS is_horse
    FROM closed_trips ct
    UNION ALL
    SELECT
        ct.trip_id,
        ct.operator_organization_id,
        ct.month_start,
        ct.departed_at,
        tt.trailer_id AS vehicle_id,
        FALSE AS is_horse
    FROM closed_trips ct
    JOIN trip_trailers tt ON tt.trip_id = ct.trip_id
)"""

# Rule 3, written once so both views attribute a breakdown identically. `e` is
# exceptions, `vt` is vehicle_trips. Each breakdown matches at most one vehicle row of its
# trip: its own vehicle, or the horse when no vehicle was recorded. A vehicle_id that
# isn't on its own trip matches none and is counted nowhere. The server only ever stores
# the trip's own horse or trailers (exception_service.pick_breakdown_vehicle), so that
# can't happen through the app.
_BREAKDOWN_BELONGS_TO_VEHICLE = (
    "e.exception_type = 'mechanical' "
    "AND (e.vehicle_id = vt.vehicle_id OR (e.vehicle_id IS NULL AND vt.is_horse))"
)

# ── Vehicle (monthly), horses and trailers ───────────────────────────────────

_VEHICLE_ANALYTICS = f"""
CREATE MATERIALIZED VIEW vehicle_analytics AS
WITH {_CLOSED_TRIPS_CTE},
{_TRIP_PHASES_CTE},
{_VEHICLE_TRIPS_CTE},
mechanical AS (
    -- The window sees the vehicle's whole closed-trip history, so each breakdown's gap
    -- is measured from the previous breakdown ON THE SAME VEHICLE, even when that one
    -- fell in an earlier month. The first-ever breakdown has no predecessor and no gap.
    SELECT
        vt.operator_organization_id,
        vt.vehicle_id,
        vt.month_start,
        e.severity,
        e.created_at - LAG(e.created_at) OVER (
            PARTITION BY vt.operator_organization_id, vt.vehicle_id
            ORDER BY e.created_at, e.id
        ) AS gap
    FROM exceptions e
    JOIN vehicle_trips vt ON vt.trip_id = e.trip_id
    WHERE {_BREAKDOWN_BELONGS_TO_VEHICLE}
),
trip_totals AS (
    SELECT operator_organization_id, vehicle_id, month_start, COUNT(*)::integer AS trip_count
    FROM vehicle_trips
    GROUP BY operator_organization_id, vehicle_id, month_start
),
mechanical_totals AS (
    SELECT
        operator_organization_id,
        vehicle_id,
        month_start,
        COUNT(*)::integer AS mechanical_exceptions_count,
        (COUNT(*) FILTER (WHERE severity = 'info'))::integer AS mechanical_info_count,
        (COUNT(*) FILTER (WHERE severity = 'warning'))::integer AS mechanical_warning_count,
        (COUNT(*) FILTER (WHERE severity = 'critical'))::integer AS mechanical_critical_count,
        COALESCE(SUM(EXTRACT(EPOCH FROM gap)::double precision / 60.0), 0)::double precision
            AS mechanical_gap_minutes_sum,
        COUNT(gap)::integer AS mechanical_gap_count
    FROM mechanical
    GROUP BY operator_organization_id, vehicle_id, month_start
),
trip_driving AS (
    -- In-transit legs only (departure -> arrival): road time, for wear and maintenance,
    -- deliberately not door-to-door duration. Summed per trip here, then credited to
    -- every vehicle on the trip below (rule 2).
    SELECT trip_id, SUM({_GAP_HOURS}) AS driving_hours
    FROM trip_phases
    WHERE phase_type = 'in_transit' AND prev_phase_type = 'departure' AND {_GAP_IS_ATTESTED}
    GROUP BY trip_id
),
driving_totals AS (
    SELECT
        vt.operator_organization_id,
        vt.vehicle_id,
        vt.month_start,
        SUM(td.driving_hours) AS driving_hours_sum
    FROM trip_driving td
    JOIN vehicle_trips vt ON vt.trip_id = td.trip_id
    GROUP BY vt.operator_organization_id, vt.vehicle_id, vt.month_start
)
SELECT
    tt.operator_organization_id,
    tt.vehicle_id,
    tt.month_start,
    tt.trip_count,
    COALESCE(mt.mechanical_exceptions_count, 0) AS mechanical_exceptions_count,
    COALESCE(mt.mechanical_info_count, 0) AS mechanical_info_count,
    COALESCE(mt.mechanical_warning_count, 0) AS mechanical_warning_count,
    COALESCE(mt.mechanical_critical_count, 0) AS mechanical_critical_count,
    COALESCE(mt.mechanical_gap_minutes_sum, 0)::double precision AS mechanical_gap_minutes_sum,
    COALESCE(mt.mechanical_gap_count, 0) AS mechanical_gap_count,
    COALESCE(dt.driving_hours_sum, 0)::double precision AS driving_hours_sum
FROM trip_totals tt
LEFT JOIN mechanical_totals mt
  ON mt.operator_organization_id = tt.operator_organization_id
 AND mt.vehicle_id = tt.vehicle_id
 AND mt.month_start = tt.month_start
LEFT JOIN driving_totals dt
  ON dt.operator_organization_id = tt.operator_organization_id
 AND dt.vehicle_id = tt.vehicle_id
 AND dt.month_start = tt.month_start
"""

# ── Vehicle incident streaks (whole history), horses and trailers ────────────
# An incident is a closed trip carrying at least one mechanical exception that belongs to
# THIS vehicle (rule 3). Two reports on the same trip are one incident. Streaks are
# counted in clean trips, never days: an idle vehicle proves nothing about reliability.

_VEHICLE_INCIDENT_STREAKS = f"""
CREATE MATERIALIZED VIEW vehicle_incident_streaks AS
WITH {_CLOSED_TRIPS_CTE},
{_VEHICLE_TRIPS_CTE},
trip_incidents AS (
    SELECT
        vt.operator_organization_id,
        vt.vehicle_id,
        vt.trip_id,
        vt.departed_at,
        EXISTS (
            SELECT 1 FROM exceptions e
            WHERE e.trip_id = vt.trip_id AND {_BREAKDOWN_BELONGS_TO_VEHICLE}
        ) AS is_incident
    FROM vehicle_trips vt
),
positioned AS (
    -- segment = how many incidents came before this trip. Clean trips sharing a
    -- segment number form one streak; segment 0 is the run before the first incident.
    SELECT
        operator_organization_id,
        vehicle_id,
        is_incident,
        (COUNT(*) FILTER (WHERE is_incident) OVER (
            PARTITION BY operator_organization_id, vehicle_id
            ORDER BY departed_at, trip_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ))::integer AS segment
    FROM trip_incidents
),
incident_totals AS (
    SELECT operator_organization_id, vehicle_id, (COUNT(*) FILTER (WHERE is_incident))::integer AS incident_count
    FROM trip_incidents
    GROUP BY operator_organization_id, vehicle_id
),
segments AS (
    -- Enumerated explicitly so a segment with ZERO clean trips (back-to-back incident
    -- trips) still exists and can be the lowest streak, instead of vanishing from a GROUP BY.
    SELECT it.operator_organization_id, it.vehicle_id, it.incident_count, s.segment
    FROM incident_totals it
    CROSS JOIN LATERAL generate_series(0, it.incident_count) AS s(segment)
),
segment_lengths AS (
    SELECT
        s.operator_organization_id,
        s.vehicle_id,
        s.incident_count,
        s.segment,
        COUNT(p.vehicle_id)::integer AS clean_trips
    FROM segments s
    LEFT JOIN positioned p
      ON p.operator_organization_id = s.operator_organization_id
     AND p.vehicle_id = s.vehicle_id
     AND p.segment = s.segment
     AND NOT p.is_incident
    GROUP BY s.operator_organization_id, s.vehicle_id, s.incident_count, s.segment
)
SELECT
    operator_organization_id,
    vehicle_id,
    -- The open segment (segment = incident_count) counts: if it already beats every
    -- completed run it is already the record.
    MAX(clean_trips)::integer AS highest_streak_trips,
    -- Completed segments only: the open one can still grow. NULL when no incident has
    -- ever closed a segment.
    (MIN(clean_trips) FILTER (WHERE segment < incident_count))::integer AS lowest_streak_trips
FROM segment_lengths
GROUP BY operator_organization_id, vehicle_id
"""

# ── Frozen copy of FP-153's horse-only views, for the downgrade ──────────────
# Verbatim from tom_analytics_read_models, including its own trip_phases CTE (keyed by
# horse). Downgrading must put back exactly what that migration created.

_HORSE_ONLY_TRIP_PHASES_CTE = """
trip_phases AS (
    SELECT
        ct.operator_organization_id,
        ct.driver_id,
        ct.horse_id,
        ct.month_start,
        pe.phase_type,
        pe.status,
        pe.dispatcher_override_user_id,
        pe.completed_at,
        LAG(pe.phase_type) OVER plan_order AS prev_phase_type,
        LAG(pe.status) OVER plan_order AS prev_status,
        LAG(pe.completed_at) OVER plan_order AS prev_completed_at
    FROM phase_events pe
    JOIN closed_trips ct ON ct.trip_id = pe.trip_id
    WINDOW plan_order AS (PARTITION BY pe.trip_id ORDER BY pe.sequence_number)
)"""

_HORSE_ONLY_VEHICLE_ANALYTICS = f"""
CREATE MATERIALIZED VIEW vehicle_analytics AS
WITH {_CLOSED_TRIPS_CTE},
{_HORSE_ONLY_TRIP_PHASES_CTE},
mechanical AS (
    -- The window sees the vehicle's whole closed-trip history, so each breakdown's gap
    -- is measured from the previous breakdown even when that one fell in an earlier
    -- month. The first-ever breakdown has no predecessor and therefore no gap.
    SELECT
        ct.operator_organization_id,
        ct.horse_id,
        ct.month_start,
        e.severity,
        e.created_at - LAG(e.created_at) OVER (
            PARTITION BY ct.operator_organization_id, ct.horse_id
            ORDER BY e.created_at, e.id
        ) AS gap
    FROM exceptions e
    JOIN closed_trips ct ON ct.trip_id = e.trip_id
    WHERE e.exception_type = 'mechanical'
),
trip_totals AS (
    SELECT operator_organization_id, horse_id, month_start, COUNT(*)::integer AS trip_count
    FROM closed_trips
    GROUP BY operator_organization_id, horse_id, month_start
),
mechanical_totals AS (
    SELECT
        operator_organization_id,
        horse_id,
        month_start,
        COUNT(*)::integer AS mechanical_exceptions_count,
        (COUNT(*) FILTER (WHERE severity = 'info'))::integer AS mechanical_info_count,
        (COUNT(*) FILTER (WHERE severity = 'warning'))::integer AS mechanical_warning_count,
        (COUNT(*) FILTER (WHERE severity = 'critical'))::integer AS mechanical_critical_count,
        COALESCE(SUM(EXTRACT(EPOCH FROM gap)::double precision / 60.0), 0)::double precision
            AS mechanical_gap_minutes_sum,
        COUNT(gap)::integer AS mechanical_gap_count
    FROM mechanical
    GROUP BY operator_organization_id, horse_id, month_start
),
driving_totals AS (
    -- In-transit legs only (departure -> arrival): road time, for wear and maintenance,
    -- deliberately not door-to-door duration.
    SELECT operator_organization_id, horse_id, month_start, SUM({_GAP_HOURS}) AS driving_hours_sum
    FROM trip_phases
    WHERE phase_type = 'in_transit' AND prev_phase_type = 'departure' AND {_GAP_IS_ATTESTED}
    GROUP BY operator_organization_id, horse_id, month_start
)
SELECT
    tt.operator_organization_id,
    tt.horse_id AS vehicle_id,
    tt.month_start,
    tt.trip_count,
    COALESCE(mt.mechanical_exceptions_count, 0) AS mechanical_exceptions_count,
    COALESCE(mt.mechanical_info_count, 0) AS mechanical_info_count,
    COALESCE(mt.mechanical_warning_count, 0) AS mechanical_warning_count,
    COALESCE(mt.mechanical_critical_count, 0) AS mechanical_critical_count,
    COALESCE(mt.mechanical_gap_minutes_sum, 0)::double precision AS mechanical_gap_minutes_sum,
    COALESCE(mt.mechanical_gap_count, 0) AS mechanical_gap_count,
    COALESCE(dt.driving_hours_sum, 0)::double precision AS driving_hours_sum
FROM trip_totals tt
LEFT JOIN mechanical_totals mt
  ON mt.operator_organization_id = tt.operator_organization_id
 AND mt.horse_id = tt.horse_id
 AND mt.month_start = tt.month_start
LEFT JOIN driving_totals dt
  ON dt.operator_organization_id = tt.operator_organization_id
 AND dt.horse_id = tt.horse_id
 AND dt.month_start = tt.month_start
"""

_HORSE_ONLY_VEHICLE_INCIDENT_STREAKS = f"""
CREATE MATERIALIZED VIEW vehicle_incident_streaks AS
WITH {_CLOSED_TRIPS_CTE},
trip_incidents AS (
    SELECT
        ct.operator_organization_id,
        ct.horse_id,
        ct.trip_id,
        ct.departed_at,
        EXISTS (
            SELECT 1 FROM exceptions e
            WHERE e.trip_id = ct.trip_id AND e.exception_type = 'mechanical'
        ) AS is_incident
    FROM closed_trips ct
),
positioned AS (
    -- segment = how many incidents came before this trip. Clean trips sharing a
    -- segment number form one streak; segment 0 is the run before the first incident.
    SELECT
        operator_organization_id,
        horse_id,
        is_incident,
        (COUNT(*) FILTER (WHERE is_incident) OVER (
            PARTITION BY operator_organization_id, horse_id
            ORDER BY departed_at, trip_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ))::integer AS segment
    FROM trip_incidents
),
incident_totals AS (
    SELECT operator_organization_id, horse_id, (COUNT(*) FILTER (WHERE is_incident))::integer AS incident_count
    FROM trip_incidents
    GROUP BY operator_organization_id, horse_id
),
segments AS (
    -- Enumerated explicitly so a segment with ZERO clean trips (back-to-back incident
    -- trips) still exists and can be the lowest streak, instead of vanishing from a GROUP BY.
    SELECT it.operator_organization_id, it.horse_id, it.incident_count, s.segment
    FROM incident_totals it
    CROSS JOIN LATERAL generate_series(0, it.incident_count) AS s(segment)
),
segment_lengths AS (
    SELECT
        s.operator_organization_id,
        s.horse_id,
        s.incident_count,
        s.segment,
        COUNT(p.horse_id)::integer AS clean_trips
    FROM segments s
    LEFT JOIN positioned p
      ON p.operator_organization_id = s.operator_organization_id
     AND p.horse_id = s.horse_id
     AND p.segment = s.segment
     AND NOT p.is_incident
    GROUP BY s.operator_organization_id, s.horse_id, s.incident_count, s.segment
)
SELECT
    operator_organization_id,
    horse_id AS vehicle_id,
    -- The open segment (segment = incident_count) counts: if it already beats every
    -- completed run it is already the record.
    MAX(clean_trips)::integer AS highest_streak_trips,
    -- Completed segments only: the open one can still grow. NULL when no incident has
    -- ever closed a segment.
    (MIN(clean_trips) FILTER (WHERE segment < incident_count))::integer AS lowest_streak_trips
FROM segment_lengths
GROUP BY operator_organization_id, horse_id
"""

# ── Indexes, Data API lockdown, statement lists ──────────────────────────────

# Dropping a view drops its unique index, and REFRESH ... CONCURRENTLY refuses to run
# without one, so both are recreated on exactly the same grain, in both directions.
_VIEW_GRAINS: dict[str, tuple[str, ...]] = {
    "vehicle_analytics": ("operator_organization_id", "vehicle_id", "month_start"),
    "vehicle_incident_streaks": ("operator_organization_id", "vehicle_id"),
}

_UNIQUE_INDEXES: tuple[str, ...] = tuple(
    f"CREATE UNIQUE INDEX uq_{view}_grain ON {view} ({', '.join(columns)})"
    for view, columns in _VIEW_GRAINS.items()
)

_DROP_VIEWS: tuple[str, ...] = tuple(
    f"DROP MATERIALIZED VIEW IF EXISTS {view}" for view in reversed(tuple(_VIEW_GRAINS))
)

# Recreated views lose FP-153's REVOKE, and Supabase's default privileges grant new
# public objects to anon/authenticated. RLS can't be enabled on a materialized view, so
# without this every operator's vehicle analytics would be readable cross-tenant through
# the Data API. Guarded on the roles existing, so it is a no-op on plain Postgres.
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
    *_DROP_VIEWS,
    _VEHICLE_ANALYTICS,
    _VEHICLE_INCIDENT_STREAKS,
    *_UNIQUE_INDEXES,
    _REVOKE_DATA_API_ACCESS,
)

DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    *_DROP_VIEWS,
    _HORSE_ONLY_VEHICLE_ANALYTICS,
    _HORSE_ONLY_VEHICLE_INCIDENT_STREAKS,
    *_UNIQUE_INDEXES,
    _REVOKE_DATA_API_ACCESS,
)


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
