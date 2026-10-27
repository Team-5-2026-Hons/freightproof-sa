// Types for the Cost tab on the fleet Analytics page (FP-294).
// Mirrors backend response models in app/schemas/cost_analytics.py.
//
// Rand amounts arrive as numbers already rounded to the cent; hours and km to one decimal.
// Operating and delay cost are ESTIMATES from the organisation's rates; cargo value exposed
// is REAL, from waybills. Never re-derive any of them here.

import type { PeriodEcho } from './fleet-analytics'
import type { PrecinctId } from './precinct'

/** The rates the figures were worked out with, and where they came from. */
export interface CostProfile {
  diesel_price_per_litre: number
  litres_per_100km: number
  fuel_per_km: number
  running_cost_per_km: number
  driver_cost_per_hour: number
  delay_cost_per_hour: number
  fixed_cost_per_trip: number
  road_factor: number
  is_default: boolean
  updated_at: string | null
  updated_by_name: string | null
}

/** An admin's change: any rate left out keeps its current value. */
export type CostProfileUpdate = Partial<Pick<
  CostProfile,
  | 'diesel_price_per_litre'
  | 'litres_per_100km'
  | 'running_cost_per_km'
  | 'driver_cost_per_hour'
  | 'delay_cost_per_hour'
  | 'fixed_cost_per_trip'
  | 'road_factor'
>>

export interface OperatingCost {
  fuel: number
  running: number
  driver: number
  fixed: number
  total: number
  trips_costed: number
  trips_not_costed: number
  distance_km: number
  legs_routed: number
  legs_estimated: number
}

export interface DelayCost {
  cost: number
  late_hours: number
  problem_trips: number
  late_problem_trips: number
  lateness_unknown: number
}

export interface ValueExposed {
  under_review: number
  reviewed: number
  total: number
  trips: number
  consignments_without_value: number
  trips_without_consignments: number
}

export interface CostBucket {
  start: string
  is_partial: boolean
  fuel: number
  running: number
  driver: number
  fixed: number
  delay_cost: number
  value_under_review: number
  value_reviewed: number
}

/** road: every leg routed by road; estimate: every leg straight line × road factor; mixed: some of each. */
export type DistanceSource = 'road' | 'estimate' | 'mixed'

export interface LaneCost {
  origin_precinct_id: PrecinctId
  origin_name: string | null
  destination_precinct_id: PrecinctId
  destination_name: string | null
  trip_count: number
  operating_total: number
  operating_per_trip: number | null
  delay_cost: number
  value_exposed: number
  distance_source: DistanceSource
}

export interface FleetCost {
  period: PeriodEcho
  rates: CostProfile
  operating: OperatingCost
  delay: DelayCost
  exposure: ValueExposed
  buckets: CostBucket[]
  lanes: LaneCost[]
}
