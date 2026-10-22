"""Response models for the dispatcher assistant (spec §4, §6).

Cards are the facts under an answer. Our server builds them from the records the tools loaded, never
from the model's text (spec D3), so a badly worded reply can't change what the dispatcher acts on.
They carry ids for links; names come from the records. They never carry ID numbers, phone numbers,
GPS positions or text a person typed (spec §5.2): the dispatcher's own pages are where those live.
"""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.db.models.enums import IncidentOutcome, IncidentStatus, IncidentType, TripStatus, TripType

RecordKind = Literal["driver", "vehicle", "trip", "precinct"]

# Spec §4. A question is a sentence or two; ten turns carry "him" and "the first horse" across a
# booking without resending a long conversation (and its cost) every time. The same limits as FP-295.
MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 2_000
# The records one answer can show: a card of trips plus their drivers and horses.
MAX_REFS_PER_TURN = 30
# Longer than any name, registration, depot or trip reference in the database (String(255) columns).
MAX_LABEL_CHARS = 255
MAX_DETAIL_CHARS = 50


class RecordRef(BaseModel):
    """One record an answer showed: what the next question's "him" or "the first horse" can mean.

    The browser sends these back with the conversation. They are never trusted: a tool that receives one
    re-loads the record by id, scoped to the caller's organisation, so a forged id is simply not found.
    The label only names the record to the model, so it is length-capped like any typed text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: RecordKind
    id: UUID
    # A driver's full name, a registration, a depot name or a trip reference.
    label: str = Field(max_length=MAX_LABEL_CHARS)
    # One fact that tells look-alikes apart: vehicle type, depot hub code, trip status.
    detail: str | None = Field(default=None, max_length=MAX_DETAIL_CHARS)
    is_active: bool = True


class NeedsReview(BaseModel):
    """A trip's exceptions waiting for a dispatcher's review, by severity (the dashboard's split)."""

    model_config = ConfigDict(frozen=True)

    critical: int
    warning: int
    info: int


class TripRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    trip_id: UUID
    trip_reference: str
    manifest: str | None
    status: TripStatus
    trip_type: TripType
    origin: str
    destination: str
    # The driver holding the trip now (after any handover, FP-83).
    driver_id: UUID
    driver: str
    horse_id: UUID
    horse: str
    trailers: list[str]
    planned_departure_at: datetime | None
    planned_arrival_at: datetime | None
    actual_departure_at: datetime | None
    actual_arrival_at: datetime | None
    current_phase: str | None
    current_stop: int | None
    phase_completed: int
    phase_total: int
    needs_review: NeedsReview
    # Live, and its planned arrival has passed.
    overdue: bool


class TripListCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["trip_list"] = "trip_list"
    title: str
    total: int
    # Of `total`: started and on the road · booked, not started · held by an exception.
    on_the_road: int
    booked: int
    on_hold: int
    window_start: datetime | None
    window_end: datetime | None
    rows: list[TripRow]
    # More trips matched than `rows` shows.
    truncated: bool
    # Where the whole list lives: the Dashboard for live trips, Trip History for closed and cancelled ones (B34).
    full_list: Literal["dashboard", "history"]


class IncidentRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    incident_id: UUID
    reference: str
    incident_type: IncidentType
    status: IncidentStatus
    trip_id: UUID
    trip_reference: str
    received_at: datetime
    investigated_by: str | None = None
    outcome: IncidentOutcome | None = None


class ReviewQueueCard(BaseModel):
    """The Exceptions page's queue in numbers: every exception waiting for review, on any trip."""

    model_config = ConfigDict(frozen=True)

    type: Literal["review_queue"] = "review_queue"
    total: int
    by_severity: NeedsReview
    claimed: int
    unclaimed: int
    on_finished_trips: int


class IncidentListCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["incident_list"] = "incident_list"
    title: str
    rows: list[IncidentRow]
    truncated: bool = False


class TripCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["trip"] = "trip"
    trip: TripRow
    # Depot names in stop order.
    stops: list[str]
    # Set when the trip was handed over: who started it.
    original_driver: str | None
    open_incidents: list[IncidentRow]
    # The trip page's Info panel and Record integrity tally (coverage audit items 3 and 5).
    delivery_confirmed_at: datetime | None
    closed_at: datetime | None
    # Minutes: positive late, negative early; None without both times.
    departure_delay_minutes: int | None
    arrival_delay_minutes: int | None
    parcels_booked: int | None
    parcels_scanned_out: int
    parcels_scanned_in: int
    journey_lock_anchored: bool
    receipts_owed: int
    receipts_anchored: int
    receipts_failed: int


class BookingRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    trip_id: UUID
    trip_reference: str
    status: TripStatus
    origin: str
    destination: str
    busy_from: datetime
    # None: busy until the trip is closed or cancelled (a live trip past its planned end).
    busy_until: datetime | None
    planned_until: datetime | None


class BookingsCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["bookings"] = "bookings"
    who: RecordRef
    window_start: datetime
    window_end: datetime
    bookings: list[BookingRow]


class ChooseCard(BaseModel):
    """Two or more records matched what was typed: each is a button that answers "which one?"."""

    model_config = ConfigDict(frozen=True)

    type: Literal["choose"] = "choose"
    what: RecordKind
    typed: str
    options: list[RecordRef]
    # Matches past the ones shown.
    more: int


DiscState = Literal["expired", "expiring", "ok", "unknown"]


class VehicleCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["vehicle"] = "vehicle"
    vehicle: RecordRef
    make: str | None
    model: str | None
    year: int | None
    length_m: int | None
    gross_vehicle_mass_kg: int | None
    licence_disc_expiry: date | None
    disc_state: DiscState
    on_trip_now: list[BookingRow]
    exceptions_to_review: NeedsReview
    exception_types: list[str]
    # Other exceptions waiting on trips it was used on: about the trip, not the vehicle.
    trip_exceptions_to_review: NeedsReview
    # Breakdowns (mechanical exceptions) recorded against it in the look-back window, reviewed or not.
    recent_breakdowns: int
    open_incidents: list[IncidentRow]


DocumentKind = Literal["driver_licence", "vehicle_disc"]


class ExpiryRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    record: RecordRef
    document: DocumentKind
    # None only when one named record has no date recorded.
    expiry: date | None
    expired: bool


class ExpiryListCard(BaseModel):
    """Drivers' licences and vehicles' licence discs: expired or due within `within_days`, or one record's."""

    model_config = ConfigDict(frozen=True)

    type: Literal["expiry_list"] = "expiry_list"
    # None when one named driver or vehicle was asked about, whatever its date.
    within_days: int | None
    rows: list[ExpiryRow]
    # Active records with no expiry date recorded, which no window can include.
    without_date: int
    truncated: bool


class HistoryRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    trip_id: UUID
    trip_reference: str
    status: TripStatus
    origin: str
    destination: str
    # When it closed, else when it left, else when it was planned to leave, else when it was booked.
    happened_at: datetime


class HistoryCard(BaseModel):
    """One driver's or vehicle's trips, counted the way its own page lists them."""

    model_config = ConfigDict(frozen=True)

    type: Literal["history"] = "history"
    who: RecordRef
    # None: all time.
    window_start: datetime | None
    window_end: datetime | None
    total: int
    completed: int
    cancelled: int
    live: int
    booked: int
    # The newest trips, newest first.
    recent: list[HistoryRow]


class RosterDepot(BaseModel):
    model_config = ConfigDict(frozen=True)

    depot: RecordRef
    address: str | None
    owned: bool


class RosterGroupCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["driver", "horse", "trailer", "depot"]
    active_total: int
    inactive_total: int | None
    records: list[RecordRef]
    depots: list[RosterDepot]
    truncated: bool


class RosterCard(BaseModel):
    """How many drivers, horses, trailers and depots there are (coverage audit item 4)."""

    model_config = ConfigDict(frozen=True)

    type: Literal["roster"] = "roster"
    groups: list[RosterGroupCard]


CrewKind = Literal["driver", "horse", "trailer"]


class BookedCrew(BaseModel):
    model_config = ConfigDict(frozen=True)

    who: RecordRef
    bookings: list[BookingRow]


class CrewGroup(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: CrewKind
    nothing_booked: list[RecordRef]
    booked: list[BookedCrew]
    # Either list was cut to fit the card.
    truncated: bool


class FreeCrewCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["free_crew"] = "free_crew"
    window_start: datetime
    window_end: datetime
    groups: list[CrewGroup]


class RouteTimeCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["route_time"] = "route_time"
    origin: RecordRef
    destination: RecordRef
    # Truck road time from the route planner: no stops, rest or loading. None when it couldn't be looked up.
    driving_minutes: int | None
    distance_km: int | None
    # Why there is no driving time ("not set up", "unavailable"), else None.
    driving_unavailable: str | None
    # Closed trips on this depot pair in the history window, and their door-to-door times.
    past_trip_count: int
    typical_minutes: int | None
    slow_minutes: int | None
    # The past times were faster than the road allows (demo or test trips), so they aren't shown.
    history_left_out: bool
    history_from: date
    history_to: date


class ParcelJourneyRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    trip_id: UUID
    trip_reference: str
    trip_status: TripStatus
    origin: str
    destination: str
    # before_pickup · within_journey · after_delivery · cancelled · unknown (parcel trace); None for a waybill-only look-up.
    position: str | None
    phase: str | None
    last_depot: str | None
    last_recorded_at: datetime | None


class ParcelCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["parcel"] = "parcel"
    barcode: str | None
    waybill: str
    journeys: list[ParcelJourneyRow]




class FormPreviewCard(BaseModel):
    """What "Open trip form" will fill in, shown before the dispatcher clicks (spec D2a, D2b)."""

    model_config = ConfigDict(frozen=True)

    type: Literal["form_preview"] = "form_preview"
    mode: Literal["empty_leg", "manifest"]
    manifest_number: int | None
    # The manifest's own route and size, when the pre-check could read it.
    manifest_summary: str | None
    driver: RecordRef | None
    horse: RecordRef | None
    trailers: list[RecordRef]
    origin: RecordRef | None
    destination: RecordRef | None
    departure: datetime | None
    arrival: datetime | None
    # Clashes and gaps the dispatcher should see before opening the form.
    warnings: list[str]


AssistantCard = Annotated[
    TripListCard | TripCard | IncidentListCard | BookingsCard | ChooseCard | VehicleCard | ExpiryListCard
    | FreeCrewCard | RouteTimeCard | ParcelCard | HistoryCard | FormPreviewCard | ReviewQueueCard
    | RosterCard,
    Field(discriminator="type"),
]


# ── Actions: buttons under an answer. They only ever open a page (spec D2): nothing is saved. ──

# The pages a button may open. The frontend maps each to its own ROUTES entry, so no URL is built here.
# No "trips" (there is no trips list page: live trips are on the Dashboard, finished ones in Trip History) and no
# "sla" (a placeholder that always shows "No data"): coverage audit L0, S1 (B34).
PageName = Literal[
    "dashboard", "trip", "history", "exceptions", "incidents", "drivers", "driver", "vehicles", "vehicle",
    "precincts", "precinct", "parcels", "analytics",
    # The Add forms, opened empty, never filled in (B41): Add precinct is its own page (/precincts/new); Add driver and
    # Add vehicle are the Drivers and Vehicles pages' pop-ups, opened by their address (lib/fleet/add-form-link.ts).
    "add_precinct", "add_driver", "add_vehicle",
]


class TripFormParams(BaseModel):
    """What to fill in on the trip form. Ids only, never names (spec D2c); times are SAST wall-clock
    "YYYY-MM-DDTHH:mm", what the form's datetime-local fields hold."""

    model_config = ConfigDict(frozen=True)

    mode: Literal["empty_leg", "manifest"]
    manifest_number: int | None
    driver_id: UUID | None
    horse_id: UUID | None
    trailer_ids: list[UUID]
    origin_precinct_id: UUID | None
    destination_precinct_id: UUID | None
    departure: str | None
    arrival: str | None


class OpenTripFormAction(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["open_trip_form"] = "open_trip_form"
    label: str
    params: TripFormParams


class OpenPageAction(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["open_page"] = "open_page"
    label: str
    page: PageName
    # The record a detail page shows (driver, vehicle, trip, precinct pages).
    record_id: UUID | None
    # Only filters the page already reads from its address (exceptions: severity, q; parcels: barcode,
    # waybill; analytics: ask). The frontend drops anything else.
    filters: dict[str, str]


AssistantAction = Annotated[OpenTripFormAction | OpenPageAction, Field(discriminator="kind")]


Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_CHARS)]
TurnText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TURN_CHARS)]


class AssistantTurn(BaseModel):
    """One earlier message, kept in the browser (spec D6): its text and the records it showed or meant."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["user", "assistant"]
    text: TurnText
    refs: list[RecordRef] = Field(default_factory=list, max_length=MAX_REFS_PER_TURN)


class AssistantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    question: Question
    # Oldest first.
    history: list[AssistantTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
    # The records the question means, when it came from a choice card's button ("I mean Tim Giltig").
    refs: list[RecordRef] = Field(default_factory=list, max_length=MAX_REFS_PER_TURN)


class AssistantSpend(BaseModel):
    model_config = ConfigDict(frozen=True)

    # This organisation's assistant spend this SAST calendar month.
    spent_usd: float
    # Both chats (this one and the Analytics chat), every organisation: what the shared budget counts (D7).
    all_chats_spent_usd: float
    budget_usd: float
    # False once all_chats_spent_usd has reached the budget.
    available: bool


AnswerKind = Literal["answer", "follow_up", "declined"]


class AssistantAnswer(BaseModel):
    model_config = ConfigDict(frozen=True)

    answer: str
    # answer: a tool ran · follow_up: it asked a question back · declined: a refusal, an out-of-scope
    # question or a cap reached, with no facts.
    kind: AnswerKind
    cards: list[AssistantCard]
    # Buttons that open a page (never save): at most MAX_ACTIONS.
    actions: list[AssistantAction]
    # The tools that ran, in order: the "Checked: Trips · Driver bookings" line under the answer.
    tools_used: list[str]
    # Every record this answer's cards show, for the next question's history.
    refs: list[RecordRef]
    # None when the spend couldn't be read (Redis down).
    spend: AssistantSpend | None


class AssistantStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool
    spend: AssistantSpend | None
