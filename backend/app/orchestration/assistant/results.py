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
    phase: str | None
    progress: str
    exceptions_to_review: Counts
    overdue: bool
    closed: str | None = None


class TripsResult(Result):
    definition: str | None
    status_group: str
    window: str | None
    which_time: str | None
    total: int
    on_the_road: int
    booked: int
    on_hold: int
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
    original_driver: str | None
    open_exceptions: OpenExceptions
    open_incidents: list[IncidentLine]
    delivery_confirmed: str | None
    closed: str | None
    departure_delay: str | None
    arrival_delay: str | None
    parcels_booked: int | None
    parcels_scanned_out: int
    parcels_scanned_in: int
    record_integrity: RecordIntegrity


class ReviewQueue(Result):
    definition: str
    total: int
    critical: int
    warning: int
    info: int
    claimed: int
    unclaimed: int
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
    busy_until: str
    was_due: str | None


class BookingsResult(Result):
    who: Who
    window: str
    nothing_booked: bool
    bookings: list[Booking]
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
    exceptions_to_review: OpenExceptions
    exceptions_on_all_its_trips: OpenExceptions
    all_trips_scope: str
    recent_breakdowns: int
    breakdown_window_days: int
    open_incidents: list[IncidentLine]
    not_recorded: str


class ExpiryLine(Result):
    ref: str
    label: str
    document: str
    detail: str | None
    expiry: str | None
    expired: bool | None
    days_left: int | None


class ExpiryResult(Result):
    scope: str
    driver_licences: list[ExpiryLine]
    vehicle_discs: list[ExpiryLine]
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
    ownership: str


class RosterGroup(Result):
    kind: str
    active_total: int
    inactive_total: int | None
    names: list[CrewName]
    depots: list[DepotLine]
    truncated: bool


class RosterResult(Result):
    groups: list[RosterGroup]
    lists_rule: str


class IncidentsResult(Result):
    status: str
    incident_type: str | None
    window: str
    total: int
    shown: int
    truncated: bool
    incidents: list[IncidentLine]
