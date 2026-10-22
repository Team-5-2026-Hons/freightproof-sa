"""Builds the explicit `SubstitutionRequestRead` for a pending, completed or cancelled request.

This is the one place that turns request rows into the wire shape, so the service returns the
same thing on first call and on replay. It is NOT the role-filtered read layer (C6's reads.py):
it carries only the fields the contract puts on `SubstitutionRequestRead`, which already
excludes dispatcher-only attestation reasons, licence numbers and identity numbers.

`completion_blocked_by` is computed live for a pending request whose two captures are both
saved: it answers "what is stopping this from completing right now?" without changing anything.
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.driver_substitutions import DriverSubstitutionConfirmation, DriverSubstitutionRequest
from app.db.models.enums import IdvsStatus, VehicleType
from app.db.models.people import Driver
from app.db.models.trips import DriverSubstitution, Trip, TripTrailer
from app.db.models.vehicles import Vehicle
from app.orchestration.substitutions.eligibility import first_completion_blocker
from app.schemas.driver_substitutions import (
    ConfirmationSummary, DriverContact, ExchangePoint, IdentitySnapshot, SubstitutionAction,
    SubstitutionCompletionMode, SubstitutionCompletionRead, SubstitutionCompletionTrigger,
    SubstitutionRequestRead, SubstitutionRole, SubstitutionState, VehicleRef,
    PLANNED_V1, IMMEDIATE_V2,
)

_ROLE_ORDER = (SubstitutionRole.OUTGOING, SubstitutionRole.INCOMING)


def required_confirmation_roles(request_format: str) -> tuple[SubstitutionRole, ...]:
    if request_format == PLANNED_V1:
        return _ROLE_ORDER
    if request_format == IMMEDIATE_V2:
        return (SubstitutionRole.INCOMING,)
    raise ValueError("Unknown driver transfer request format")


@dataclass(frozen=True)
class Viewer:
    """Whose permitted actions the read advertises. Presentation guidance only: the server
    enforces each action independently."""

    is_dispatcher: bool = False
    is_admin: bool = False
    driver_role: SubstitutionRole | None = None


def permitted_actions(
    *, state: SubstitutionState, viewer: Viewer, confirmed: set[SubstitutionRole], identity: IdvsStatus,
    required_roles: tuple[SubstitutionRole, ...] = _ROLE_ORDER,
) -> list[SubstitutionAction]:
    if state is not SubstitutionState.PENDING:
        return []
    actions: list[SubstitutionAction] = []
    if viewer.is_dispatcher:
        actions += [SubstitutionAction.CANCEL, SubstitutionAction.REPLACE, SubstitutionAction.COMPLETE_ATTESTED]
        if viewer.is_admin and identity is IdvsStatus.PENDING:
            actions.append(SubstitutionAction.ATTEST_IDENTITY)
    elif viewer.driver_role in required_roles and viewer.driver_role not in confirmed:
        actions.append(SubstitutionAction.CONFIRM_OUTGOING if viewer.driver_role is SubstitutionRole.OUTGOING
                       else SubstitutionAction.CONFIRM_INCOMING)
    return actions


async def trip_vehicle_ids(db: AsyncSession, trip: Trip) -> list[uuid.UUID]:
    """The horse then its trailers: the complete assigned set a capture must cover."""
    trailers = (await db.execute(
        select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip.id).order_by(TripTrailer.trailer_id)
    )).scalars().all()
    return [trip.horse_id, *trailers]


def _contact(driver: Driver) -> DriverContact:
    return DriverContact(id=driver.id, full_name=driver.full_name, phone_number=driver.phone_number)


def _legacy_exchange(request: DriverSubstitutionRequest) -> ExchangePoint:
    return ExchangePoint.model_validate({"label": request.exchange_label, "latitude": request.exchange_latitude,
        "longitude": request.exchange_longitude, "instructions": request.exchange_instructions})


async def build_request_read(
    db: AsyncSession, request: DriverSubstitutionRequest, *, viewer: Viewer, now: datetime,
) -> SubstitutionRequestRead:
    # created_at and updated_at are server-side values; reading them off a just-flushed row
    # would lazy-load, which is illegal in an async session.
    await db.refresh(request)
    (read,) = await build_request_reads(db, [request], viewer=viewer, now=now)
    return read


@dataclass(frozen=True)
class Preloaded:
    """What a caller already holds about the requests' trip, so the batch does not fetch it again.

    `trip` must have been read with the caller's own organisation filter: build_request_reads does
    not re-check tenancy, it only checks the trip is the requests' trip. `drivers` and
    `completed_by_request` (the trip's completed substitution rows keyed by request id) are optional
    extras; anything missing is read.
    """

    trip: Trip
    drivers: Mapping[uuid.UUID, Driver] = field(default_factory=dict)
    completed_by_request: Mapping[uuid.UUID, DriverSubstitution] | None = None


@dataclass(frozen=True)
class _BatchContext:
    trip: Trip
    drivers: Mapping[uuid.UUID, Driver]
    vehicles: list[VehicleRef]
    saved_by_request: Mapping[uuid.UUID, Mapping[SubstitutionRole, DriverSubstitutionConfirmation]]
    completed_by_request: Mapping[uuid.UUID, DriverSubstitution]


async def build_request_reads(
    db: AsyncSession, requests: Sequence[DriverSubstitutionRequest], *, viewer: Viewer, now: datetime,
    preloaded: Preloaded | None = None,
) -> list[SubstitutionRequestRead]:
    """The wire shape of every request on ONE trip, with the lookups shared by the whole batch.

    A trip page lists every arrangement on the trip, so per-request reads of the trip, the drivers,
    the vehicles, the confirmations and the completed row cost a round trip each, per request.
    Here each is one statement however many requests there are.
    """
    if not requests:
        return []
    trip_id = requests[0].trip_id
    if any(request.trip_id != trip_id for request in requests):
        raise ValueError("build_request_reads takes the requests of a single trip")
    context = await _load_context(db, requests, preloaded)
    return [await _request_read(db, request, context, viewer=viewer, now=now) for request in requests]


async def _load_context(
    db: AsyncSession, requests: Sequence[DriverSubstitutionRequest], preloaded: Preloaded | None,
) -> _BatchContext:
    trip_id = requests[0].trip_id
    trip = preloaded.trip if preloaded is not None else await db.get(Trip, trip_id)
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.id != trip_id:
        raise ValueError("The preloaded trip is not the requests' trip")
    drivers = await _drivers_for(db, requests, preloaded.drivers if preloaded is not None else {})

    vehicle_ids = await trip_vehicle_ids(db, trip)
    vehicles_by_id = {
        vehicle.id: vehicle for vehicle in (await db.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))).scalars()
    }
    vehicles = [
        VehicleRef(id=v.id, registration=v.registration, vehicle_type=VehicleType(v.vehicle_type))
        for v in (vehicles_by_id[vehicle_id] for vehicle_id in vehicle_ids)
    ]

    completed = preloaded.completed_by_request if preloaded is not None else None
    return _BatchContext(
        trip=trip, drivers=drivers, vehicles=vehicles,
        saved_by_request=await _confirmations_for(db, requests),
        completed_by_request=completed if completed is not None else await _completed_for(db, requests),
    )


async def _drivers_for(
    db: AsyncSession, requests: Sequence[DriverSubstitutionRequest], known: Mapping[uuid.UUID, Driver],
) -> dict[uuid.UUID, Driver]:
    drivers = dict(known)
    missing = {
        driver_id for request in requests for driver_id in (request.outgoing_driver_id, request.incoming_driver_id)
        if driver_id not in drivers
    }
    if missing:
        drivers.update({
            driver.id: driver for driver in (await db.execute(select(Driver).where(Driver.id.in_(missing)))).scalars()
        })
    return drivers


async def _confirmations_for(
    db: AsyncSession, requests: Sequence[DriverSubstitutionRequest],
) -> dict[uuid.UUID, dict[SubstitutionRole, DriverSubstitutionConfirmation]]:
    saved: dict[uuid.UUID, dict[SubstitutionRole, DriverSubstitutionConfirmation]] = {r.id: {} for r in requests}
    for confirmation in (await db.execute(
        select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id.in_(saved))
    )).scalars():
        saved[confirmation.request_id][SubstitutionRole(confirmation.role)] = confirmation
    return saved


async def _completed_for(
    db: AsyncSession, requests: Sequence[DriverSubstitutionRequest],
) -> dict[uuid.UUID, DriverSubstitution]:
    completed_ids = [r.id for r in requests if SubstitutionState(r.state) is SubstitutionState.COMPLETED]
    found: dict[uuid.UUID, DriverSubstitution] = {}
    if not completed_ids:
        return found
    for row in (await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.request_id.in_(completed_ids))
    )).scalars():
        if row.request_id in found:
            raise ValueError("A request has more than one completed substitution")
        found[row.request_id] = row
    return found


async def _request_read(
    db: AsyncSession, request: DriverSubstitutionRequest, context: _BatchContext, *, viewer: Viewer, now: datetime,
) -> SubstitutionRequestRead:
    trip, drivers, vehicles = context.trip, context.drivers, context.vehicles
    saved = context.saved_by_request[request.id]
    completed = context.completed_by_request.get(request.id)
    outgoing, incoming = drivers[request.outgoing_driver_id], drivers[request.incoming_driver_id]
    confirmations = [
        ConfirmationSummary(
            id=saved[role].id, role=role, driver_id=saved[role].driver_id,
            captured_at=saved[role].captured_at, received_at=saved[role].received_at,
        )
        for role in _ROLE_ORDER if role in saved
    ]
    state = SubstitutionState(request.state)
    required = required_confirmation_roles(request.request_format)
    # Only a completed request is read against its substitution row, whatever the caller handed over.
    if state is not SubstitutionState.COMPLETED:
        completed = None

    if completed is not None:
        # Frozen at completion; never re-read from the driver, whose status may have moved since.
        if completed.incoming_identity_observed_at is None:
            raise ValueError("Completed request has no recorded identity observation")
        identity = IdentitySnapshot(
            driver_id=incoming.id, status=IdvsStatus(completed.incoming_identity_status),
            last_verified_at=completed.incoming_identity_last_verified_at,
            observed_at=completed.incoming_identity_observed_at,
        )
    else:
        identity = IdentitySnapshot(
            driver_id=incoming.id, status=IdvsStatus(incoming.idvs_status),
            last_verified_at=incoming.idvs_last_verified_at, observed_at=now,
        )

    blocked = None
    if state is SubstitutionState.PENDING and set(required).issubset(saved):
        blocked = await first_completion_blocker(db, trip=trip, incoming=incoming, now=now, identity_attested=False)

    completion = None
    if completed is not None:
        by_driver = completed.completed_by_driver_id is not None
        completion = SubstitutionCompletionRead(
            trigger=SubstitutionCompletionTrigger.DRIVER_CONFIRMATION if by_driver
            else SubstitutionCompletionTrigger.DISPATCHER_ACTION,
            completed_by_driver_id=completed.completed_by_driver_id, completed_by_user_id=completed.completed_by_user_id,
        )

    return SubstitutionRequestRead(
        id=request.id, trip_id=request.trip_id, trip_reference=trip.trip_reference, version=request.version,
        state=state, outgoing=_contact(outgoing), incoming=_contact(incoming), vehicles=vehicles,
        exchange=_legacy_exchange(request) if request.request_format == PLANNED_V1 else None,
        expected_at=request.expected_at, is_planned=request.is_planned, reason=request.reason,
        request_format="planned_v1" if request.request_format == PLANNED_V1 else "immediate_v2",
        confirmation_policy="two_driver_v1" if request.request_format == PLANNED_V1 else "incoming_acceptance_v2",
        required_confirmation_roles=list(required), reservation_start_at=request.reservation_start_at,
        created_at=request.created_at, confirmations=confirmations, identity=identity,
        missing_confirmations=[role for role in required if role not in saved],
        completed_substitution_id=completed.id if completed else None,
        effective_at=completed.substitution_at if completed else None,
        completion_mode=SubstitutionCompletionMode(completed.completion_mode) if completed else None,
        completion_blocked_by=blocked, replacement_request_id=request.replacement_request_id,
        completion=completion,
        permitted_actions=permitted_actions(
            state=state, viewer=viewer, confirmed=set(saved), identity=identity.status, required_roles=required,
        ),
    )
