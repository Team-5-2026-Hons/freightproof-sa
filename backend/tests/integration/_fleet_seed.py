"""Seeding helpers shared by the fleet analytics integration tests (test_fleet_*.py).

Not a test module: no test_ prefix, so pytest never collects it. Copied in spirit from
test_analytics_endpoints.py (_Operator, _seed_trip) rather than imported, so neither suite
depends on the other's private helpers. Every timestamp is derived from "now", in SAST.
"""

import uuid
from collections.abc import Sequence
from decimal import Decimal
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus,
    ArtifactType,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    HandoverTokenRejectionReason,
    IdvsStatus,
    OrganizationType,
    PhaseStatus,
    PhaseType,
    TripStatus,
    TripType,
    VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.handover import HandoverCapabilityToken, HandoverConfirmation, HandoverTokenAttempt
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle

from tests.conftest import auth_header, make_token

# SAST, the calendar every fleet figure is bucketed in. A fixed offset is exact: no DST.
SAST = timezone(timedelta(hours=settings.OPERATIONS_UTC_OFFSET_HOURS))

# Minutes after a trip's start at which SINGLE_LEG attests its departure and its arrival.
DEPARTURE_MINUTE = 100
ARRIVAL_MINUTE = 400
# The plan the seeded trips carry: 20 minutes after the actual departure, so on time.
PLANNED_DEPARTURE_MINUTE = 120
PLANNED_ARRIVAL_MINUTE = 400
# The hour of the SAST day a seeded "n days ago" instant falls at.
_DEFAULT_HOUR = 8
_ID_NUMBER_DIGITS = 13
_CLOSED_AFTER = timedelta(days=1)
# How long a seeded capability token lives: long enough never to matter to a test.
_TOKEN_LIFETIME = timedelta(hours=1)


@dataclass(frozen=True)
class Operator:
    org: Organization
    dispatcher: User
    driver: Driver
    horse: Vehicle


@dataclass(frozen=True)
class Step:
    """One phase row, completed `minute` minutes after the trip's start (unless pending)."""

    phase_type: PhaseType
    stop: int | None
    minute: float
    status: PhaseStatus = PhaseStatus.COMPLETED
    anchor_status: AnchorStatus = AnchorStatus.NOT_REQUIRED
    geofence: bool | None = None


@dataclass(frozen=True)
class SeededTrip:
    trip: Trip
    # In plan order, so a test can link an exception to a step by index or type.
    phases: list[PhaseEvent]

    def phase(self, phase_type: PhaseType) -> PhaseEvent:
        return next(phase for phase in self.phases if phase.phase_type == phase_type)


# origin (stop 0) -> destination (stop 1), every step attested and every receipt anchored.
SINGLE_LEG: tuple[Step, ...] = (
    Step(PhaseType.TRIP_CREATION, None, 0, anchor_status=AnchorStatus.ANCHORED),
    Step(PhaseType.ACTIVATION, 0, 30),
    Step(PhaseType.LOADING, 0, 90),
    Step(PhaseType.DEPARTURE, 0, DEPARTURE_MINUTE, anchor_status=AnchorStatus.ANCHORED),
    Step(PhaseType.IN_TRANSIT, 0, ARRIVAL_MINUTE),
    Step(PhaseType.UNLOADING, 1, 440),
    Step(PhaseType.CONFIRMATION, 1, 460, anchor_status=AnchorStatus.ANCHORED),
)


def replace_step(steps: Sequence[Step], phase_type: PhaseType, **changes: Any) -> tuple[Step, ...]:
    """The same plan with the first step of `phase_type` changed."""
    index = next(i for i, step in enumerate(steps) if step.phase_type == phase_type)
    return (*steps[:index], replace(steps[index], **changes), *steps[index + 1:])


def not_started(steps: Sequence[Step] = SINGLE_LEG) -> tuple[Step, ...]:
    """A just-created trip: only trip creation is done. The steps still ahead are pending,
    and so are their receipts, which is what trip creation writes for anchored phases."""
    return tuple(
        step if step.phase_type == PhaseType.TRIP_CREATION else replace(
            step,
            status=PhaseStatus.PENDING,
            anchor_status=(
                AnchorStatus.NOT_REQUIRED
                if step.anchor_status == AnchorStatus.NOT_REQUIRED else AnchorStatus.PENDING
            ),
        )
        for step in steps
    )


# ── Time, always relative to now ─────────────────────────────────────────────


def today_sast() -> date:
    return datetime.now(SAST).date()


def at_sast(day: date, hour: int = _DEFAULT_HOUR, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=SAST)


def days_ago(days: int, hour: int = _DEFAULT_HOUR) -> datetime:
    return at_sast(today_sast() - timedelta(days=days), hour)


def start_for_departure(departed_at: datetime, steps: Sequence[Step] = SINGLE_LEG) -> datetime:
    """The trip start that makes `steps` attest their departure exactly at `departed_at`."""
    departure = next(step for step in steps if step.phase_type == PhaseType.DEPARTURE)
    return departed_at - timedelta(minutes=departure.minute)


# ── People, vehicles, organisations ──────────────────────────────────────────


def headers(operator: Operator) -> dict[str, str]:
    return auth_header(make_token(
        sub=str(operator.dispatcher.id), role="dispatcher", org_id=str(operator.org.id),
    ))


def operator_from_seed(seed: dict[str, Any]) -> Operator:
    return Operator(
        org=seed["org"], dispatcher=seed["dispatcher"], driver=seed["driver"], horse=seed["horse"],
    )


def new_vehicle(
    organization_id: uuid.UUID,
    vehicle_type: VehicleType,
    *,
    licence_disc_expiry: date | None = None,
    is_active: bool = True,
) -> Vehicle:
    tag = uuid.uuid4().hex[:8].upper()
    return Vehicle(
        id=uuid.uuid4(), organization_id=organization_id, vehicle_type=vehicle_type,
        registration=f"R{tag}", pulsit_device_id=f"PUL-{tag}",
        licence_disc_expiry=licence_disc_expiry, is_active=is_active,
    )


def new_driver(
    organization_id: uuid.UUID, *, license_expiry: date | None = None, is_active: bool = True,
) -> Driver:
    # id_number is unique per organisation, so each driver gets its own random 13 digits.
    id_number = f"{uuid.uuid4().int % 10**_ID_NUMBER_DIGITS:0{_ID_NUMBER_DIGITS}d}"
    return Driver(
        id=uuid.uuid4(), organization_id=organization_id, full_name="Fleet test driver",
        id_number=id_number, phone_number="+27820000002",
        license_number=f"LIC-{uuid.uuid4().hex[:8]}",
        license_expiry=license_expiry, is_active=is_active,
    )


async def other_operator(db: AsyncSession) -> Operator:
    """A second operator, to prove one organisation never sees another's numbers."""
    tag = uuid.uuid4().hex[:8]
    org = Organization(id=uuid.uuid4(), name=f"Other operator {tag}", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    dispatcher = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"other-{tag}@test.co.za", full_name="Other dispatcher",
    )
    driver = new_driver(org.id)
    horse = new_vehicle(org.id, VehicleType.HORSE)
    db.add_all([dispatcher, driver, horse])
    await db.flush()
    return Operator(org=org, dispatcher=dispatcher, driver=driver, horse=horse)


# ── Trips and exceptions ─────────────────────────────────────────────────────


async def seed_trip(
    db: AsyncSession,
    operator: Operator,
    *,
    stops: Sequence[Precinct],
    start: datetime,
    status: TripStatus = TripStatus.CLOSED,
    trip_type: TripType = TripType.LOADED,
    steps: Sequence[Step] = SINGLE_LEG,
    horse: Vehicle | None = None,
    trailers: Sequence[Vehicle] = (),
    closed_at: datetime | None = None,
    driver: Driver | None = None,
    planned_departure_minute: float | None = PLANNED_DEPARTURE_MINUTE,
    planned_arrival_minute: float | None = PLANNED_ARRIVAL_MINUTE,
) -> SeededTrip:
    """One trip with its stops, trailers and full phase ledger, created at `start`.

    A closed or cancelled trip ends a day after its start unless `closed_at` says otherwise.
    A planned minute of None leaves that plan time unset, as for a trip booked without one.
    """

    def at(minute: float) -> datetime:
        return start + timedelta(minutes=minute)

    arrivals = [
        at(step.minute) for step in steps
        if step.phase_type == PhaseType.IN_TRANSIT and step.status in (PhaseStatus.COMPLETED, PhaseStatus.EXCEPTION)
    ]
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-FL-{uuid.uuid4().hex[:10]}",
        order_number=f"ORD-{uuid.uuid4().hex[:10]}",
        operator_organization_id=operator.org.id,
        driver_id=(driver or operator.driver).id,
        horse_id=(horse or operator.horse).id,
        origin_precinct_id=stops[0].id,
        destination_precinct_id=stops[-1].id,
        status=status,
        trip_type=trip_type,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=operator.dispatcher.id,
        planned_departure_at=None if planned_departure_minute is None else at(planned_departure_minute),
        planned_arrival_at=None if planned_arrival_minute is None else at(planned_arrival_minute),
        # The final leg's attested arrival, as phase_service sets it; None until then.
        actual_arrival_at=arrivals[-1] if arrivals else None,
        created_at=start,
        closed_at=(
            (closed_at or start + _CLOSED_AFTER)
            if status in (TripStatus.CLOSED, TripStatus.CANCELLED) else None
        ),
    )
    db.add(trip)
    await db.flush()

    # Linked exactly as trip creation does it (trip_service), snapshot included.
    db.add_all([
        TripTrailer(
            trip_id=trip.id, trailer_id=trailer.id,
            pulsit_device_id_snapshot=trailer.pulsit_device_id,
        )
        for trailer in trailers
    ])
    trip_stops = [
        TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=index + 1)
        for index, precinct in enumerate(stops)
    ]
    db.add_all(trip_stops)
    await db.flush()

    phases = [
        PhaseEvent(
            id=uuid.uuid4(),
            trip_id=trip.id,
            trip_stop_id=None if step.stop is None else trip_stops[step.stop].id,
            phase_type=step.phase_type,
            sequence_number=index,
            status=step.status,
            anchor_status=step.anchor_status,
            pulsit_geofence_confirmed=step.geofence,
            dispatcher_override_user_id=(
                operator.dispatcher.id if step.status == PhaseStatus.OVERRIDDEN else None
            ),
            completed_at=None if step.status == PhaseStatus.PENDING else at(step.minute),
        )
        for index, step in enumerate(steps)
    ]
    db.add_all(phases)
    await db.flush()
    return SeededTrip(trip=trip, phases=phases)


async def add_exception(
    db: AsyncSession,
    trip: Trip,
    *,
    exception_type: ExceptionType,
    severity: ExceptionSeverity,
    created_at: datetime,
    source: ExceptionSource = ExceptionSource.SYSTEM,
    review_status: ExceptionReviewStatus = ExceptionReviewStatus.RECORDED,
    phase_event: PhaseEvent | None = None,
    reviewed_at: datetime | None = None,
    review_outcome: ExceptionReviewOutcome | None = None,
    gps: tuple[str, str] | None = None,
) -> TripException:
    exception = TripException(
        id=uuid.uuid4(),
        trip_id=trip.id,
        phase_event_id=phase_event.id if phase_event is not None else None,
        exception_type=exception_type,
        source=source,
        severity=severity,
        description="seeded by the fleet analytics tests",
        review_status=review_status,
        reviewed_at=reviewed_at,
        review_outcome=review_outcome,
        gps_lat=None if gps is None else Decimal(gps[0]),
        gps_lng=None if gps is None else Decimal(gps[1]),
        created_at=created_at,
    )
    db.add(exception)
    await db.flush()
    return exception


# ── Receiver QR sign-off (FP-155) ────────────────────────────────────────────


async def add_receiver_confirmation(
    db: AsyncSession, seeded: SeededTrip, *, confirmed_at: datetime, bearer_token_present: bool = False,
) -> HandoverConfirmation:
    """A receiver's scan-and-sign on the trip's confirmation step, built as the handover flow
    builds it: a redeemed capability token and the attestation artifact the receiver signed."""
    confirmation = seeded.phase(PhaseType.CONFIRMATION)
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=seeded.trip.id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"test/{uuid.uuid4().hex}.png", s3_bucket="fleet-tests", file_hash=uuid.uuid4().hex * 2,
        mime_type="image/png", captured_at=confirmed_at,
    )
    token = HandoverCapabilityToken(
        id=uuid.uuid4(), phase_event_id=confirmation.id, trip_id=seeded.trip.id,
        trip_stop_id=confirmation.trip_stop_id, token_hash=uuid.uuid4().hex * 2,
        expires_at=confirmed_at + _TOKEN_LIFETIME, redeemed_at=confirmed_at,
    )
    db.add_all([artifact, token])
    await db.flush()
    row = HandoverConfirmation(
        id=uuid.uuid4(), token_id=token.id, phase_event_id=confirmation.id, trip_id=seeded.trip.id,
        signature_artifact_id=artifact.id, bearer_token_present=bearer_token_present, confirmed_at=confirmed_at,
    )
    db.add(row)
    await db.flush()
    return row


async def add_token_attempt(
    db: AsyncSession, trip: Trip, *, attempted_at: datetime, rejection_reason: HandoverTokenRejectionReason | None,
) -> HandoverTokenAttempt:
    """One scan attempt presented against `trip`. None as the reason means it was accepted."""
    attempt = HandoverTokenAttempt(
        id=uuid.uuid4(), presented_trip_id=trip.id, presented_trip_stop_id=uuid.uuid4(),
        rejection_reason=rejection_reason, attempted_at=attempted_at,
    )
    db.add(attempt)
    await db.flush()
    return attempt
