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

MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 2_000
MAX_REFS_PER_TURN = 30
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
    label: str = Field(max_length=MAX_LABEL_CHARS)
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
    overdue: bool


class TripListCard(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["trip_list"] = "trip_list"
    title: str
    total: int
    on_the_road: int
    booked: int
    on_hold: int
    window_start: datetime | None
    window_end: datetime | None
    rows: list[TripRow]
    truncated: bool
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
    stops: list[str]
    original_driver: str | None
    open_incidents: list[IncidentRow]
    delivery_confirmed_at: datetime | None
    closed_at: datetime | None
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
    trip_exceptions_to_review: NeedsReview
    recent_breakdowns: int
    open_incidents: list[IncidentRow]


DocumentKind = Literal["driver_licence", "vehicle_disc"]


class ExpiryRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    record: RecordRef
    document: DocumentKind
    expiry: date | None
    expired: bool


class ExpiryListCard(BaseModel):
    """Drivers' licences and vehicles' licence discs: expired or due within `within_days`, or one record's."""

    model_config = ConfigDict(frozen=True)

    type: Literal["expiry_list"] = "expiry_list"
    within_days: int | None
    rows: list[ExpiryRow]
    without_date: int
    truncated: bool


class HistoryRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    trip_id: UUID
    trip_reference: str
    status: TripStatus
    origin: str
    destination: str
    happened_at: datetime


class HistoryCard(BaseModel):
    """One driver's or vehicle's trips, counted the way its own page lists them."""

    model_config = ConfigDict(frozen=True)

    type: Literal["history"] = "history"
    who: RecordRef
    window_start: datetime | None
    window_end: datetime | None
    total: int
    completed: int
    cancelled: int
    live: int
    booked: int
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
    driving_minutes: int | None
    distance_km: int | None
    driving_unavailable: str | None
    past_trip_count: int
    typical_minutes: int | None
    slow_minutes: int | None
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
    manifest_summary: str | None
    driver: RecordRef | None
    horse: RecordRef | None
    trailers: list[RecordRef]
    origin: RecordRef | None
    destination: RecordRef | None
    departure: datetime | None
    arrival: datetime | None
    warnings: list[str]


AssistantCard = Annotated[
    TripListCard | TripCard | IncidentListCard | BookingsCard | ChooseCard | VehicleCard | ExpiryListCard
    | FreeCrewCard | RouteTimeCard | ParcelCard | HistoryCard | FormPreviewCard | ReviewQueueCard
    | RosterCard,
    Field(discriminator="type"),
]


PageName = Literal[
    "dashboard", "trip", "history", "exceptions", "incidents", "drivers", "driver", "vehicles", "vehicle",
    "precincts", "precinct", "parcels", "analytics",
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
    record_id: UUID | None
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
    history: list[AssistantTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
    refs: list[RecordRef] = Field(default_factory=list, max_length=MAX_REFS_PER_TURN)


class AssistantSpend(BaseModel):
    model_config = ConfigDict(frozen=True)

    spent_usd: float
    all_chats_spent_usd: float
    budget_usd: float
    available: bool


AnswerKind = Literal["answer", "follow_up", "declined"]


class AssistantAnswer(BaseModel):
    model_config = ConfigDict(frozen=True)

    answer: str
    kind: AnswerKind
    cards: list[AssistantCard]
    actions: list[AssistantAction]
    tools_used: list[str]
    refs: list[RecordRef]
    spend: AssistantSpend | None


class AssistantStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool
    spend: AssistantSpend | None
