"""What the model is sent back from a tool: trimmed, field by field (assistant spec §5.2, rule 13).

Never a service response dumped whole: `DriverRead` alone carries `id_number`, `phone_number` and
`license_number`. Allowed here: names, registrations, trip references, depot names, statuses, phase,
counts, exception and incident types, and times written the way dispatchers read them ("Thu 22 Oct,
17:00", from `trips.availability.format_when`), so the model never formats or works out a time.
Never: ID or phone numbers, licence numbers, GPS positions, or any text a person typed (exception
descriptions, incident summaries, notes), which also keeps instructions hidden in that text away
from the model. `tests/unit/test_assistant_pii.py` walks every model here.

Records are named by their RefBook tag (`ref`), never by a database id.
"""

from pydantic import BaseModel, ConfigDict

ACTIVE_DEFINITION = (
    "Active = booked but not started, on the road, or on hold: the Dashboard's Active Trips list shows the same trips."
)
BOOKINGS_NOTE = (
    "Only trips are recorded. Leave, sickness and legal driving hours are not, so say 'nothing booked', "
    "never 'available'."
)
CHOOSE_INSTRUCTION = "Ask the dispatcher which one they mean. Answer nothing about them until they choose."


class Result(BaseModel):
    model_config = ConfigDict(frozen=True)


class Counts(Result):
    critical: int
    warning: int
    info: int


class TripLine(Result):
    ref: str
    trip_reference: str
    manifest: str | None
    status: str
    trip_type: str
    origin: str
    destination: str
    driver: str
    horse: str
    trailers: list[str]
    planned_departure: str | None
    planned_arrival: str | None
    actual_departure: str | None
    actual_arrival: str | None
    # "in transit, stop 2": the trip's current phase and stop.
    phase: str | None
    # "6 of 11 steps done".
    progress: str
    exceptions_to_review: Counts
    overdue: bool
    # When it was closed or cancelled: only on lists matched by that date (which_time "closed").
    closed: str | None = None


class TripsResult(Result):
    # What "active" means; only on the active group (other groups mean what they say).
    definition: str | None
    status_group: str
    window: str | None
    which_time: str | None
    total: int
    on_the_road: int
    booked: int
    on_hold: int
    # Live trips past their planned arrival, in this status group, whatever the window.
    overdue_total: int
    shown: int
    truncated: bool
    trips: list[TripLine]


class Option(Result):
    ref: str
    label: str
    detail: str | None
    active: bool


class NeedsChoice(Result):
    what: str
    typed: str
    options: list[Option]
    more: int
    instruction: str


class IncidentLine(Result):
    reference: str
    incident_type: str
    status: str
    trip_reference: str
    received: str
    exceptions_total: int
    parcels_total: int
    # Coverage audit item 7: the staff member assigned (a name, D1), affected parcels nothing is known about yet,
    # and the outcome's code (never `closure_reason` or `summary`: a person typed those).
    investigated_by: str | None = None
    parcels_unresolved: int = 0
    outcome: str | None = None


class OpenExceptions(Counts):
    types: list[str]


class RecordIntegrity(Result):
    """What the trip page's Record integrity section shows from stored receipts. NOT a verdict (rule)."""

    journey_lock_anchored: bool
    phase_receipts_owed: int
    phase_receipts_anchored: int
    phase_receipts_failed: int
    rule: str


class TripStatusResult(Result):
    trip: TripLine
    stops: list[str]
    # Who started the trip, when it has since been handed over.
    original_driver: str | None
    open_exceptions: OpenExceptions
    open_incidents: list[IncidentLine]
    # The trip page's Info panel, each worked out by code so the model never subtracts (coverage audit item 5).
    delivery_confirmed: str | None
    closed: str | None
    departure_delay: str | None
    arrival_delay: str | None
    # Null when a consignment has no expected count (the page shows a dash then); 0 for an empty leg.
    parcels_booked: int | None
    parcels_scanned_out: int
    parcels_scanned_in: int
    record_integrity: RecordIntegrity


class ReviewQueue(Result):
    # The Exceptions page's own count ("N needing review"): every exception waiting for review, on any trip.
    definition: str
    total: int
    critical: int
    warning: int
    info: int
    claimed: int
    unclaimed: int
    # Of `total`, those on closed or cancelled trips: why this can be more than the live trips below.
    on_finished_trips: int


class AttentionResult(Result):
    review_queue: ReviewQueue
    trips_total: int
    shown: int
    truncated: bool
    trips: list[TripLine]
    open_incidents: list[IncidentLine]


class Who(Result):
    ref: str
    label: str
    kind: str
    active: bool


class Booking(Result):
    trip_ref: str
    trip_reference: str
    status: str
    origin: str
    destination: str
    busy_from: str
    # "until the trip is closed" for a live trip past its planned end.
    busy_until: str
    was_due: str | None


class BookingsResult(Result):
    who: Who
    window: str
    nothing_booked: bool
    bookings: list[Booking]
    # Our own fixed sentence (BOOKINGS_NOTE), never text a person typed.
    wording_rule: str


class VehicleSpecs(Result):
    """What the vehicle's page shows about the truck itself (coverage audit item 8). No personal data."""

    make: str | None
    model: str | None
    year: int | None
    length_m: int | None
    gross_vehicle_mass_kg: int | None


class VehicleStatusResult(Result):
    vehicle: Who
    specs: VehicleSpecs
    licence_disc: str
    on_trip_now: list[Booking]
    # Naming this vehicle (and, for a horse, its trips' breakdowns that name no vehicle).
    exceptions_to_review: OpenExceptions
    # Other exceptions waiting on EVERY trip it was used on, past and present: about those trips, not the vehicle.
    # Named and explained so the model can't read it as the current trip's count (Tom's browser test, 22 Oct, B38).
    exceptions_on_all_its_trips: OpenExceptions
    all_trips_scope: str
    recent_breakdowns: int
    breakdown_window_days: int
    open_incidents: list[IncidentLine]
    not_recorded: str


class ExpiryLine(Result):
    ref: str
    label: str
    # "driver licence" or "vehicle disc".
    document: str
    # The vehicle's type; null for a driver.
    detail: str | None
    # Null only for one named record with no date recorded.
    expiry: str | None
    expired: bool | None
    days_left: int | None


class ExpiryResult(Result):
    # "expired or expiring within 30 days", or "one driver" / "one vehicle".
    scope: str
    driver_licences: list[ExpiryLine]
    vehicle_discs: list[ExpiryLine]
    # Active records looked at, and how many of them have no expiry date recorded.
    drivers_checked: int
    vehicles_checked: int
    drivers_without_date: int
    vehicles_without_date: int
    truncated: bool


class CrewName(Result):
    ref: str
    label: str


class BookedLine(Result):
    ref: str
    label: str
    bookings: list[Booking]


class CrewGroupResult(Result):
    kind: str
    nothing_booked_total: int
    nothing_booked: list[CrewName]
    booked_total: int
    booked: list[BookedLine]
    truncated: bool


class FreeCrewResult(Result):
    window: str
    groups: list[CrewGroupResult]
    wording_rule: str


class RouteTimeResult(Result):
    origin: str
    destination: str
    driving_time: str | None
    distance_km: int | None
    driving_basis: str
    past_trips: int
    typical_time: str | None
    slow_time: str | None
    history: str
    # Set when the past times were faster than the road allows and are therefore not given.
    history_left_out: str | None
    arrival_rule: str


class ParcelTripLine(Result):
    trip_ref: str
    trip_reference: str
    status: str
    origin: str
    destination: str
    where: str | None
    phase: str | None
    last_depot: str | None
    last_recorded: str | None


class ParcelResult(Result):
    barcode: str | None
    waybill: str
    trips: list[ParcelTripLine]
    detail_level: str


class WaybillChoice(Result):
    barcode: str
    waybills: list[str]
    instruction: str


class HistoryLine(Result):
    trip_ref: str
    trip_reference: str
    status: str
    origin: str
    destination: str
    happened: str


class HistoryResult(Result):
    who: Who
    # How the trips are counted, in the page's own words.
    counted_as: str
    window: str
    total: int
    completed: int
    cancelled: int
    live: int
    booked: int
    first_completed: str | None
    last_completed: str | None
    recent: list[HistoryLine]


class TripFormResult(Result):
    # The button the app shows under the reply.
    button: str
    mode: str
    manifest_number: int | None
    manifest_route: str | None
    driver: str | None
    horse: str | None
    trailers: list[str]
    origin: str | None
    destination: str | None
    departure: str | None
    arrival: str | None
    # Fields the dispatcher still has to fill in on the form.
    still_blank: list[str]
    warnings: list[str]
    rule: str


class PageResult(Result):
    button: str


class AnalyticsRedirectResult(Result):
    button: str
    analytics_chat_on: bool
    rule: str


class DepotLine(Result):
    ref: str
    name: str
    address: str | None
    # "ours" or "shared with us".
    ownership: str


class RosterGroup(Result):
    kind: str
    active_total: int
    # Null for depots (they have no active flag).
    inactive_total: int | None
    names: list[CrewName]
    depots: list[DepotLine]
    truncated: bool


class RosterResult(Result):
    groups: list[RosterGroup]
    # Our own fixed sentence about what the pages list.
    lists_rule: str


class IncidentsResult(Result):
    status: str
    incident_type: str | None
    window: str
    total: int
    shown: int
    truncated: bool
    incidents: list[IncidentLine]
