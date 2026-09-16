// Fleet-wide Analytics page (docs/design-notes/2026-09-15-fleet-analytics-page-spec.md).
// Mirrors backend response models in app/schemas/fleet_analytics.py.
//
// Every rate is `number | null`. null means its denominator was zero and must render as
// "—", never 0%. Rates arrive already divided by the backend; never re-derive them here.

import type { DurationStats } from './analytics'
import type {
  DispatcherReviewOutcome,
  ExceptionId,
  ExceptionSeverity,
  ExceptionSource,
  ExceptionType,
} from './exception'
import type { PrecinctId } from './precinct'
import type { TripId } from './trip'
import type { VehicleId, VehicleType } from './vehicle'

/** How a trend chart groups time. Weeks start on Monday, as the backend's do. */
export type Grain = 'week' | 'month' | 'year'

export interface CriticalWaiting {
  count: number
  /** ISO instant the longest-waiting one was raised. null when nothing is waiting. */
  oldest_created_at: string | null
}

/** Separate bands, never cumulative. More than 180 days away is in none of them. */
export interface ExpiryBands {
  expired: number
  within_30_days: number
  within_90_days: number
  within_180_days: number
  no_date: number
}

export interface LicenceExpiry {
  drivers: ExpiryBands
  vehicle_discs: ExpiryBands
}

export interface UnusedVehicle {
  vehicle_id: VehicleId
  registration: string
  vehicle_type: VehicleType
}

/** Vehicles only, never drivers (spec D13). Ordered horses first, then by registration. */
export interface UnusedVehicles {
  window_days: number
  vehicles: UnusedVehicle[]
}

export interface FleetTiles {
  live_trips: number
  critical_waiting: CriticalWaiting
  licence_expiry: LicenceExpiry
  unused_vehicles: UnusedVehicles
  /** "YYYY-MM-DD" (SAST): the first day "All time" covers, so the page knows which View-by
   *  options All time allows before any chart asks for data. */
  all_time_start: string
}

/** The period an answer covers, as the server resolved it: "All time" comes back with its
 *  real first day. Dates are SAST "YYYY-MM-DD". */
export interface PeriodEcho {
  start: string
  end: string
  grain: Grain | null
}

/** Chart 1.1: closed trips that first departed in the bucket. */
export interface TripsBucket {
  bucket_start: string
  /** Not a whole week/month/year inside the period: drawn faded. */
  is_partial: boolean
  loaded_count: number
  empty_count: number
}

/** Chart 1.7: trips that ended (closed or cancelled) in the bucket. */
export interface CancellationsBucket {
  bucket_start: string
  is_partial: boolean
  cancelled_count: number
  ended_count: number
  cancelled_rate: number | null
}

/** The note lives on the trip page, so the table links there instead (spec D20). */
export interface CancelledTrip {
  trip_id: TripId
  trip_reference: string
  /** ISO instant. */
  cancelled_at: string
}

export interface FleetActivity {
  period: PeriodEcho
  trips: TripsBucket[]
  cancellations: CancellationsBucket[]
  /** Newest first. */
  cancelled_trips: CancelledTrip[]
}

export interface PatternBar {
  key: number
  event_count: number
  /** Days of the period with this hour / weekday / date / month: the divisor. */
  day_count: number
  /** null when the period never reaches this bar (e.g. the 31st in a short period). */
  average_per_day: number | null
}

/** Complete and in clock/calendar order: 24 hours, 7 weekdays (Monday = 0), 31 dates,
 *  12 months. Never sorted by size. */
export interface PatternSet {
  hour_of_day: PatternBar[]
  weekday: PatternBar[]
  day_of_month: PatternBar[]
  month_of_year: PatternBar[]
}

/** Both event types in one answer, so the Departures | Arrivals switch never refetches. */
export interface FleetPatterns {
  period: PeriodEcho
  departures: PatternSet
  arrivals: PatternSet
}

/** Chart 2.1. Strict: on or before the plan, no grace window. */
export interface PunctualityBucket {
  bucket_start: string
  is_partial: boolean
  departures_with_plan: number
  on_time_departures: number
  arrivals_with_plan: number
  on_time_arrivals: number
  on_time_departure_rate: number | null
  on_time_arrival_rate: number | null
}

export type LatenessBand = 'early' | 'on_time' | 'late_1_15' | 'late_15_60' | 'late_60_180' | 'late_over_180'

/** Chart 2.2, over the whole period. All six bands, always, early first. */
export interface LatenessBar {
  band: LatenessBand
  trip_count: number
}

/** Chart 2.5's nine columns, left to right: finished early (furthest first), on plan, ran over. */
export type PlanBand =
  | 'early_over_180' | 'early_60_180' | 'early_15_60' | 'early_0_15'
  | 'on_plan'
  | 'over_0_15' | 'over_15_60' | 'over_60_180' | 'over_over_180'

export interface PlanBandCount {
  band: PlanBand
  trip_count: number
}

/** Chart 2.5, whole period. Medians are positive minutes on both sides. */
export interface PlanSpread {
  bands: PlanBandCount[]
  early_count: number
  over_count: number
  on_plan_count: number
  median_early_minutes: number | null
  median_over_minutes: number | null
}

export interface FleetOnTime {
  period: PeriodEcho
  punctuality: PunctualityBucket[]
  lateness: { departures: LatenessBar[]; arrivals: LatenessBar[] }
  plan_spread: PlanSpread
}

// Every count excludes dispatcher notes: every cancellation and override records one, so
// counting them would make "problems" rise whenever a dispatcher does their job.

/** Chart 3.1. Info is returned but not drawn (nothing raises it today). */
export interface ProblemsPerTripBucket {
  bucket_start: string
  is_partial: boolean
  trip_count: number
  info_count: number
  warning_count: number
  critical_count: number
  warning_per_100: number | null
  critical_per_100: number | null
}

/** Chart 3.2. by_type holds every theft-sign type, zeros included, in one stable order. */
export interface TheftSignalsBucket {
  bucket_start: string
  is_partial: boolean
  total_count: number
  by_type: Record<string, number>
}

/** Chart 3.3: one row per (type, source) with a count above zero. */
export interface ProblemTypeCount {
  exception_type: ExceptionType
  source: ExceptionSource
  count: number
}

/** Chart 3.4: the linked step's phase type, or "unlinked". In plan order, "unlinked" last. */
export interface ProblemStepCount {
  step: string
  count: number
}

export type DayBlock = 'night' | 'morning' | 'afternoon' | 'evening'

/** Chart 3.5: share of driving time against share of problems raised while driving. */
export interface RiskyTimeBlock {
  block: DayBlock
  driving_minutes: number
  driving_share: number | null
  road_problem_count: number
  road_problem_share: number | null
}

export interface FleetProblems {
  period: PeriodEcho
  per_trip: ProblemsPerTripBucket[]
  theft_signals: TheftSignalsBucket[]
  by_type: ProblemTypeCount[]
  by_step: ProblemStepCount[]
  risky_times: RiskyTimeBlock[]
}

// Not limited to closed trips: reviewing is independent of trip status. Migration-only
// legacy_review markers are never counted.

export type ReviewAgeBand = 'under_1h' | '1h_to_24h' | '1d_to_3d' | 'over_3d'

/** Chart 4.1, right now. All four bands, youngest first. */
export interface WaitingAgeBar {
  band: ReviewAgeBand
  count: number
}

/** Chart 4.2: critical problems still waiting at the bucket's end (or now, if sooner). */
export interface QueueBucket {
  bucket_start: string
  is_partial: boolean
  waiting_at_end: number
}

/** Chart 4.3, bucketed by when the review happened. */
export interface TimeToReviewBucket {
  bucket_start: string
  is_partial: boolean
  reviewed_count: number
  median_hours: number | null
  mean_hours: number | null
}

/** Chart 4.4: all five real outcomes, zeros included, in a fixed order. */
export interface ReviewOutcomeCount {
  outcome: DispatcherReviewOutcome
  count: number
}

export interface FleetReview {
  period: PeriodEcho
  waiting_by_age: WaitingAgeBar[]
  queue: QueueBucket[]
  time_to_review: TimeToReviewBucket[]
  outcomes: ReviewOutcomeCount[]
}

/** Chart 5.1: tracker (Pulsit) checks at stops. agreement_rate leaves unwitnessed out of the
 *  denominator: "could not check" is not a failure. */
export interface TrackerBucket {
  bucket_start: string
  is_partial: boolean
  confirmed_count: number
  mismatch_count: number
  unwitnessed_count: number
  agreement_rate: number | null
}

/** Chart 5.2: share of all closed-trip steps a dispatcher overrode. */
export interface OverridesBucket {
  bucket_start: string
  is_partial: boolean
  phase_count: number
  override_count: number
  override_rate: number | null
}

/** Chart 5.7: sign-offs the receiver confirmed by scanning the QR. */
export interface ReceiverSignoffBucket {
  bucket_start: string
  is_partial: boolean
  confirmation_count: number
  receiver_scan_count: number
  receiver_scan_rate: number | null
}

export interface SignoffFlags {
  /** Confirmations sent from a device already signed in to FreightProof (FP-240). */
  same_phone_count: number
  rejected_attempt_count: number
}

export interface FleetEvidence {
  period: PeriodEcho
  tracker: TrackerBucket[]
  overrides: OverridesBucket[]
  receiver_signoff: ReceiverSignoffBucket[]
  signoff_flags: SignoffFlags
}

/** Chart 1.6: attested pickups (loading) and deliveries (unloading on loaded trips) at a site. */
export interface SiteActivity {
  precinct_id: PrecinctId
  precinct_name: string | null
  pickup_count: number
  delivery_count: number
}

/** Charts 2.4 and 6.3: one origin → destination lane over the period. */
export interface LaneRisk {
  origin_precinct_id: PrecinctId
  origin_name: string | null
  destination_precinct_id: PrecinctId
  destination_name: string | null
  trip_count: number
  /** First departure to final arrival, per trip, pooled for the whole period. */
  driving_minutes: DurationStats
  /** Excludes dispatcher notes, unlike the lane view's exception_count. */
  problem_count: number
  problems_per_trip: number | null
}

export interface FleetRoutes {
  period: PeriodEcho
  /** Busiest first. */
  sites: SiteActivity[]
  lanes: LaneRisk[]
}

/** One located report. Deliberately nothing about the person: no driver name, phone or id
 *  (spec D14, POPIA). */
export interface IncidentPin {
  exception_id: ExceptionId
  trip_id: TripId
  trip_reference: string
  exception_type: ExceptionType
  severity: ExceptionSeverity
  /** ISO instant. */
  created_at: string
  lat: number
  lng: number
}

export interface FleetIncidents {
  period: PeriodEcho
  pins: IncidentPin[]
  /** Reports in the period that carried no location. */
  unlocated_count: number
}
