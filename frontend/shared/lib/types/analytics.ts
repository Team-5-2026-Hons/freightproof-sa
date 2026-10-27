// Dispatcher analytics: per-grain numbers over CLOSED trips only. Mirrors backend
// response models in schemas/analytics_api.py.
//
// Every rate and average is `number | null`. null means its denominator was zero and must
// render as "—", never 0%. Rates arrive already divided by the backend; never re-derive them.

import type { DriverId } from './driver'
import type { PrecinctId } from './precinct'
import type { VehicleId, VehicleType } from './vehicle'

export interface DriverMetrics {
  driver_id: DriverId
  driver_name: string | null
  trip_count: number
  trips_with_exceptions_count: number
  total_exceptions_count: number
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
  arrival_dwell_minutes_sum: number
  arrival_dwell_events_count: number
  unloading_dwell_minutes_sum: number
  unloading_dwell_events_count: number
  confirmation_dwell_minutes_sum: number
  confirmation_dwell_events_count: number
  phase_events_count: number
  override_count: number
  shared_trip_count?: number
  exception_trip_rate: number | null
  on_time_departure_rate: number | null
  override_rate: number | null
  activation_dwell_minutes_avg: number | null
  loading_dwell_minutes_avg: number | null
  departure_dwell_minutes_avg: number | null
  arrival_dwell_minutes_avg: number | null
  unloading_dwell_minutes_avg: number | null
  confirmation_dwell_minutes_avg: number | null
}

export interface VehicleMetrics {
  vehicle_id: VehicleId
  registration: string | null
  vehicle_type: VehicleType | null
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
  actual_transit_minutes: DurationStats
  schedule_delta_minutes: DurationStats
  exception_density: number | null
}

export interface FacilityMetrics {
  precinct_id: PrecinctId
  precinct_name: string | null
  confirmed_count: number
  mismatch_count: number
  unwitnessed_count: number
  corroboration_rate: number | null
}
