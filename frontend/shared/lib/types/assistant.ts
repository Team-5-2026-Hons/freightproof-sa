// Types for the dispatcher assistant (the bottom-right helper bubble).
// Mirrors backend models in app/schemas/assistant.py.
//
// Cards are built by the server from the records the tools loaded, never from the model's text, so
// the pop-up shows them as they arrive. Times are ISO strings (UTC); dates are "YYYY-MM-DD".

import type { CoarseTripStatus } from './phase'

export type RecordKind = 'driver' | 'vehicle' | 'trip' | 'precinct'

/** One record an answer showed: sent back with the conversation so "him" means the same driver. */
export interface RecordRef {
  kind: RecordKind
  id: string
  label: string
  detail?: string | null
  is_active?: boolean
}

export interface NeedsReview {
  critical: number
  warning: number
  info: number
}

export interface TripRow {
  trip_id: string
  trip_reference: string
  manifest: string | null
  status: CoarseTripStatus
  trip_type: 'loaded' | 'empty_leg'
  origin: string
  destination: string
  driver_id: string
  driver: string
  horse_id: string
  horse: string
  trailers: string[]
  planned_departure_at: string | null
  planned_arrival_at: string | null
  actual_departure_at: string | null
  actual_arrival_at: string | null
  current_phase: string | null
  current_stop: number | null
  phase_completed: number
  phase_total: number
  needs_review: NeedsReview
  overdue: boolean
}

export interface TripListCard {
  type: 'trip_list'
  title: string
  total: number
  on_the_road: number
  booked: number
  on_hold: number
  window_start: string | null
  window_end: string | null
  rows: TripRow[]
  truncated: boolean
  full_list: 'dashboard' | 'history'
}

export interface IncidentRow {
  incident_id: string
  reference: string
  incident_type: 'hijacking' | 'parcel_shortage' | 'parcel_damage'
  status: 'open' | 'investigating' | 'closed'
  trip_id: string
  trip_reference: string
  received_at: string
  investigated_by: string | null
  outcome: IncidentOutcome | null
}

export type IncidentOutcome =
  | 'recording_error' | 'cargo_recovered' | 'partial_recovery' | 'shortage_confirmed' | 'damage_confirmed'

export interface IncidentListCard {
  type: 'incident_list'
  title: string
  rows: IncidentRow[]
  truncated: boolean
}

/** The Exceptions page's queue in numbers: every exception waiting for review, on any trip. */
export interface ReviewQueueCard {
  type: 'review_queue'
  total: number
  by_severity: NeedsReview
  claimed: number
  unclaimed: number
  on_finished_trips: number
}

export interface TripCard {
  type: 'trip'
  trip: TripRow
  stops: string[]
  original_driver: string | null
  open_incidents: IncidentRow[]
  delivery_confirmed_at: string | null
  closed_at: string | null
  departure_delay_minutes: number | null
  arrival_delay_minutes: number | null
  parcels_booked: number | null
  parcels_scanned_out: number
  parcels_scanned_in: number
  journey_lock_anchored: boolean
  receipts_owed: number
  receipts_anchored: number
  receipts_failed: number
}

export interface BookingRow {
  trip_id: string
  trip_reference: string
  status: CoarseTripStatus
  origin: string
  destination: string
  busy_from: string
  busy_until: string | null
  planned_until: string | null
}

export interface BookingsCard {
  type: 'bookings'
  who: RecordRef
  window_start: string
  window_end: string
  bookings: BookingRow[]
}

export interface ChooseCard {
  type: 'choose'
  what: RecordKind
  typed: string
  options: RecordRef[]
  more: number
}

export type DiscState = 'expired' | 'expiring' | 'ok' | 'unknown'

export interface VehicleCard {
  type: 'vehicle'
  vehicle: RecordRef
  make: string | null
  model: string | null
  year: number | null
  length_m: number | null
  gross_vehicle_mass_kg: number | null
  licence_disc_expiry: string | null
  disc_state: DiscState
  on_trip_now: BookingRow[]
  exceptions_to_review: NeedsReview
  exception_types: string[]
  trip_exceptions_to_review: NeedsReview
  recent_breakdowns: number
  open_incidents: IncidentRow[]
}

export type DocumentKind = 'driver_licence' | 'vehicle_disc'

export interface ExpiryRow {
  record: RecordRef
  document: DocumentKind
  expiry: string | null
  expired: boolean
}

/** Drivers' licences and vehicles' discs: expired or due within `within_days`, or one record's date. */
export interface ExpiryListCard {
  type: 'expiry_list'
  within_days: number | null
  rows: ExpiryRow[]
  without_date: number
  truncated: boolean
}

export interface HistoryRow {
  trip_id: string
  trip_reference: string
  status: CoarseTripStatus
  origin: string
  destination: string
  happened_at: string
}

/** One driver's or vehicle's trips, counted the way its own page lists them. */
export interface HistoryCard {
  type: 'history'
  who: RecordRef
  window_start: string | null
  window_end: string | null
  total: number
  completed: number
  cancelled: number
  live: number
  booked: number
  recent: HistoryRow[]
}

export type RosterKind = 'driver' | 'horse' | 'trailer' | 'depot'

export interface RosterDepot {
  depot: RecordRef
  address: string | null
  owned: boolean
}

export interface RosterGroupCard {
  kind: RosterKind
  active_total: number
  inactive_total: number | null
  records: RecordRef[]
  depots: RosterDepot[]
  truncated: boolean
}

/** How many active drivers, horses, trailers and depots there are, as their pages list them. */
export interface RosterCard {
  type: 'roster'
  groups: RosterGroupCard[]
}

export type CrewKind = 'driver' | 'horse' | 'trailer'

export interface BookedCrew {
  who: RecordRef
  bookings: BookingRow[]
}

export interface CrewGroup {
  kind: CrewKind
  nothing_booked: RecordRef[]
  booked: BookedCrew[]
  truncated: boolean
}

export interface FreeCrewCard {
  type: 'free_crew'
  window_start: string
  window_end: string
  groups: CrewGroup[]
}

export interface RouteTimeCard {
  type: 'route_time'
  origin: RecordRef
  destination: RecordRef
  driving_minutes: number | null
  distance_km: number | null
  driving_unavailable: string | null
  past_trip_count: number
  typical_minutes: number | null
  slow_minutes: number | null
  history_left_out: boolean
  history_from: string
  history_to: string
}

export interface ParcelJourneyRow {
  trip_id: string
  trip_reference: string
  trip_status: CoarseTripStatus
  origin: string
  destination: string
  position: string | null
  phase: string | null
  last_depot: string | null
  last_recorded_at: string | null
}

export interface ParcelCard {
  type: 'parcel'
  barcode: string | null
  waybill: string
  journeys: ParcelJourneyRow[]
}

/** What "Open trip form" will fill in, shown before the dispatcher clicks. */
export interface FormPreviewCard {
  type: 'form_preview'
  mode: 'empty_leg' | 'manifest'
  manifest_number: number | null
  manifest_summary: string | null
  driver: RecordRef | null
  horse: RecordRef | null
  trailers: RecordRef[]
  origin: RecordRef | null
  destination: RecordRef | null
  departure: string | null
  arrival: string | null
  warnings: string[]
}

export type AssistantCard =
  | TripListCard
  | TripCard
  | IncidentListCard
  | ReviewQueueCard
  | BookingsCard
  | ChooseCard
  | VehicleCard
  | ExpiryListCard
  | FreeCrewCard
  | RouteTimeCard
  | ParcelCard
  | HistoryCard
  | RosterCard
  | FormPreviewCard

/** The trip form's fields to fill in. Ids only, never names; times are SAST wall-clock "YYYY-MM-DDTHH:mm". */
export interface TripFormParams {
  mode: 'empty_leg' | 'manifest'
  manifest_number: number | null
  driver_id: string | null
  horse_id: string | null
  trailer_ids: string[]
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  departure: string | null
  arrival: string | null
}

export interface OpenTripFormAction {
  kind: 'open_trip_form'
  label: string
  params: TripFormParams
}

/** No trips list page exists (live trips are on the Dashboard) and /sla has no data, so neither is offered. */
export type PageName =
  | 'dashboard' | 'trip' | 'history' | 'exceptions' | 'incidents' | 'drivers' | 'driver'
  | 'vehicles' | 'vehicle' | 'precincts' | 'precinct' | 'parcels' | 'analytics'
  | 'add_precinct' | 'add_driver' | 'add_vehicle'

export interface OpenPageAction {
  kind: 'open_page'
  label: string
  page: PageName
  record_id: string | null
  filters: Record<string, string>
}

/** A button under an answer. It only ever opens a page: nothing is saved. */
export type AssistantAction = OpenTripFormAction | OpenPageAction

export interface AssistantTurn {
  role: 'user' | 'assistant'
  text: string
  refs: RecordRef[]
}

export interface AssistantRequest {
  question: string
  history: AssistantTurn[]
  refs: RecordRef[]
}

export interface AssistantSpend {
  spent_usd: number
  all_chats_spent_usd: number
  budget_usd: number
  available: boolean
}

export type AssistantAnswerKind = 'answer' | 'follow_up' | 'declined'

export interface AssistantAnswer {
  answer: string
  kind: AssistantAnswerKind
  cards: AssistantCard[]
  actions: AssistantAction[]
  tools_used: string[]
  refs: RecordRef[]
  spend: AssistantSpend | null
}

export interface AssistantStatus {
  enabled: boolean
  spend: AssistantSpend | null
}
