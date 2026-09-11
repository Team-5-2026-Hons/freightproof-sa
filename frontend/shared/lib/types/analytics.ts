// Dispatcher analytics (FP-156): per-grain numbers over CLOSED trips only.
// Mirrors the backend response models in schemas/analytics_api.py, which subclass the
// FP-153 result models in schemas/analytics.py.
//
// Every rate and average is `number | null`. null means its denominator was zero — no
// observations — and must render as "—", never as 0%. Rates arrive already divided by the
// backend, once, from the counts shipped beside them; never re-derive them here.

import type { DriverId } from './driver'
import type { PrecinctId } from './precinct'
import type { VehicleId } from './vehicle'

export interface DriverMetrics {
  driver_id: DriverId
  /** null when no driver record in the caller's organisation matches the id. */
  driver_name: string | null
  trip_count: number
  trips_with_exceptions_count: number
  total_exceptions_count: number
  // Severities stay separate counts — never blended into one number.
  info_exceptions_count: number
  warning_exceptions_count: number
  critical_exceptions_count: number
  departures_with_plan_count: number
  on_time_departures_count: number
  activation_dwell_minutes_sum: number
  activation_dwell_events_count: number
  loading_dwell_minutes_sum: number
  loading_dwell_events_count: number
  departure_dwell_minutes_sum: number
  departure_dwell_events_count: number
  unloading_dwell_minutes_sum: number
  unloading_dwell_events_count: number
  confirmation_dwell_minutes_sum: number
  confirmation_dwell_events_count: number
  phase_events_count: number
  override_count: number
  exception_trip_rate: number | null
  on_time_departure_rate: number | null
  override_rate: number | null
  activation_dwell_minutes_avg: number | null
  loading_dwell_minutes_avg: number | null
  departure_dwell_minutes_avg: number | null
  unloading_dwell_minutes_avg: number | null
  /** Not purely driver behaviour — a slow receiver also lengthens it. The screen must
   *  show that caveat beside this number (FP-153 schema description). */
  confirmation_dwell_minutes_avg: number | null
}

export interface VehicleMetrics {
  vehicle_id: VehicleId
  /** null when no vehicle in the caller's organisation matches the id. */
  registration: string | null
  trip_count: number
  mechanical_exceptions_count: number
  mechanical_info_count: number
  mechanical_warning_count: number
  mechanical_critical_count: number
  mechanical_gap_minutes_sum: number
  mechanical_gap_count: number
  driving_hours_sum: number
  mean_minutes_between_mechanical: number | null
}

/** Whole-history, so it is never filtered by the month range. */
export interface VehicleStreak {
  vehicle_id: VehicleId
  highest_streak_trips: number
  /** null until a mechanical incident has closed at least one streak. */
  lowest_streak_trips: number | null
  trips_since_last_incident: number
}

/** Distribution of one lane measure, in minutes. Every statistic is null when
 *  sample_count is 0. */
export interface DurationStats {
  sample_count: number
  mean: number | null
  minimum: number | null
  maximum: number | null
  median: number | null
  p90: number | null
}

export interface LaneMetrics {
  origin_precinct_id: PrecinctId
  destination_precinct_id: PrecinctId
  origin_precinct_name: string | null
  destination_precinct_name: string | null
  trip_count: number
  exception_count: number
  /** How long the route physically takes. */
  actual_transit_minutes: DurationStats
  /** Actual minus planned, per trip — positive is late. Fewer samples than
   *  actual_transit_minutes when some trips had no plan. */
  schedule_delta_minutes: DurationStats
  exception_density: number | null
}

export interface FacilityMetrics {
  precinct_id: PrecinctId
  precinct_name: string | null
  confirmed_count: number
  mismatch_count: number
  /** No Pulsit reading was taken. A coverage problem, deliberately kept OUT of
   *  corroboration_rate's denominator — "could not check" is not a failure. */
  unwitnessed_count: number
  /** confirmed / (confirmed + mismatch). */
  corroboration_rate: number | null
}
