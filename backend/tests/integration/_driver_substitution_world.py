"""Seed helpers shared by the FP-83 C2 access, availability and concurrency tests.

One operator organisation with a driver cast (original A, incoming B, a third driver C and a
stranger D from another organisation), a trip with a full single-leg phase plan, and helpers
that append completed handovers or pending requests directly. C3 owns the real lifecycle
service; C2 only needs the persisted facts it reads, so these write them straight to the tables.
"""

import uuid
from dataclasses import dataclass
from functools import cache
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionRequest
from app.db.models.enums import (
    IdvsStatus, OrganizationType, PhaseStatus, PhaseType, TripStatus, TripType, VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution, Trip, TripStop
from app.db.models.vehicles import Vehicle
from tests.conftest import auth_header, make_token

PLANNED_HOURS = 8


@dataclass
class SubWorld:
    org_id: uuid.UUID
    client_org_id: uuid.UUID
    other_org_id: uuid.UUID
    user_id: uuid.UUID
    a: uuid.UUID
    b: uuid.UUID
    c: uuid.UUID
    d: uuid.UUID
    horse_id: uuid.UUID
    origin_id: uuid.UUID
    dest_id: uuid.UUID
    trip_id: uuid.UUID
    activation_id: uuid.UUID
    confirmation_id: uuid.UUID


@cache
def _driver_token(driver_id: uuid.UUID) -> str:
    return make_token(sub=str(driver_id), role="driver")


def driver_headers(driver_id: uuid.UUID) -> dict[str, str]:
    """One token (so one session) per driver: the one-device rule refuses a second token
    issued in the same second as the first."""
    return auth_header(_driver_token(driver_id))


def make_driver(organization_id: uuid.UUID, *, name: str = "Driver") -> Driver:
    suffix = uuid.uuid4().hex[:8]
    return Driver(
        id=uuid.uuid4(), organization_id=organization_id, full_name=f"{name} {suffix}",
        id_number=str(uuid.uuid4().int)[:13], phone_number=f"+2782{suffix[:7]}",
        license_number=f"DRV-{suffix}",
    )


async def build_world(
    db: AsyncSession, *, status: TripStatus = TripStatus.ACTIVE,
    departure: datetime | None = None, arrival: datetime | None = None,
) -> SubWorld:
    """Org with drivers A/B/C, a stranger D elsewhere, and trip A is driving with a phase plan."""
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    other_org = Organization(id=uuid.uuid4(), name="Elsewhere", org_type=OrganizationType.OPERATOR)
    db.add_all([org, client_org, other_org])
    await db.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4()}@test.co.za", full_name="D")
    a, b, c = (make_driver(org.id, name=name) for name in ("A", "B", "C"))
    d = make_driver(other_org.id, name="D")
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"R{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:6]}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db.add_all([user, a, b, c, d, horse, origin, dest])
    await db.flush()

    now = datetime.now(UTC)
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-SUB",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=a.id, horse_id=horse.id, origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=status, idvs_check_status=IdvsStatus.VERIFIED, created_by_user_id=user.id,
        trip_type=TripType.EMPTY_LEG.value, planned_departure_at=departure or now,
        planned_arrival_at=arrival or now + timedelta(hours=PLANNED_HOURS),
    )
    db.add(trip)
    await db.flush()

    stop0 = TripStop(trip_id=trip.id, precinct_id=origin.id, sequence=0)
    stop1 = TripStop(trip_id=trip.id, precinct_id=dest.id, sequence=1)
    db.add_all([stop0, stop1])
    await db.flush()
    activation = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop0.id,
        sequence_number=1, status=PhaseStatus.PENDING,
    )
    confirmation = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, phase_type=PhaseType.CONFIRMATION, trip_stop_id=stop1.id,
        sequence_number=7, status=PhaseStatus.PENDING,
    )
    db.add_all([
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        activation, confirmation,
    ])
    await db.flush()
    return SubWorld(
        org_id=org.id, client_org_id=client_org.id, other_org_id=other_org.id, user_id=user.id, a=a.id, b=b.id, c=c.id, d=d.id,
        horse_id=horse.id, origin_id=origin.id, dest_id=dest.id, trip_id=trip.id,
        activation_id=activation.id, confirmation_id=confirmation.id,
    )


def pending_request(
    world: SubWorld, *, outgoing: uuid.UUID, incoming: uuid.UUID, expected_at: datetime,
    trip_id: uuid.UUID | None = None, state: str = "pending",
) -> DriverSubstitutionRequest:
    return DriverSubstitutionRequest(
        id=uuid.uuid4(), trip_id=trip_id or world.trip_id, outgoing_driver_id=outgoing,
        incoming_driver_id=incoming, exchange_label="Depot", exchange_latitude=-32.35,
        exchange_longitude=22.58, exchange_instructions="Gate 2", expected_at=expected_at,
        reason="Shift limit", is_planned=True, arranged_by_user_id=world.user_id, version=1, state=state,
    )


async def add_pending(
    db: AsyncSession, world: SubWorld, *, outgoing: uuid.UUID, incoming: uuid.UUID,
    expected_at: datetime, trip_id: uuid.UUID | None = None,
) -> DriverSubstitutionRequest:
    request = pending_request(world, outgoing=outgoing, incoming=incoming, expected_at=expected_at, trip_id=trip_id)
    db.add(request)
    await db.flush()
    return request


async def complete_handover(
    db: AsyncSession, world: SubWorld, *, outgoing: uuid.UUID, incoming: uuid.UUID,
) -> DriverSubstitution:
    """Append the next completed link on the world's trip (a request-backed, new-style row)."""
    previous = (await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == world.trip_id)
        .order_by(DriverSubstitution.sequence_number.desc()).limit(1)
    )).scalar_one_or_none()
    request = pending_request(world, outgoing=outgoing, incoming=incoming, expected_at=datetime.now(UTC), state="completed")
    db.add(request)
    await db.flush()
    row = DriverSubstitution(
        id=uuid.uuid4(), trip_id=world.trip_id, original_driver_id=outgoing, substituting_driver_id=incoming,
        exchange_location="Depot", approving_dispatcher_user_id=world.user_id, is_planned=True,
        substitution_at=datetime.now(UTC),
        sequence_number=(previous.sequence_number + 1) if previous else 1,
        previous_substitution_id=previous.id if previous else None,
        request_id=request.id, completed_by_user_id=world.user_id,
    )
    db.add(row)
    await db.flush()
    return row


async def chain_length(db: AsyncSession, trip_id: uuid.UUID) -> int:
    return (await db.execute(
        select(func.count()).select_from(DriverSubstitution).where(DriverSubstitution.trip_id == trip_id)
    )).scalar_one()


async def add_trip(
    db: AsyncSession, world: SubWorld, *, driver_id: uuid.UUID, status: TripStatus,
    departure: datetime, arrival: datetime | None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A second trip in the world's organisation on its own horse, with an activation phase.

    Returns (trip_id, activation_phase_event_id).
    """
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=world.org_id, vehicle_type=VehicleType.HORSE,
        registration=f"S{uuid.uuid4().hex[:6].upper()}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:6]}",
    )
    db.add(horse)
    await db.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-2",
        operator_organization_id=world.org_id, client_organization_id=world.client_org_id,
        driver_id=driver_id, horse_id=horse.id, origin_precinct_id=world.origin_id,
        destination_precinct_id=world.dest_id, status=status, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=world.user_id, planned_departure_at=departure, planned_arrival_at=arrival,
    )
    db.add(trip)
    await db.flush()
    stop = TripStop(trip_id=trip.id, precinct_id=world.origin_id, sequence=0)
    db.add(stop)
    await db.flush()
    activation = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, phase_type=PhaseType.ACTIVATION, trip_stop_id=stop.id,
        sequence_number=1, status=PhaseStatus.PENDING,
    )
    db.add_all([
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.COMPLETED),
        activation,
        PhaseEvent(trip_id=trip.id, phase_type=PhaseType.LOADING, trip_stop_id=stop.id, sequence_number=2, status=PhaseStatus.PENDING),
    ])
    await db.flush()
    return trip.id, activation.id


async def tear_down(sessionmaker, world: SubWorld) -> None:
    """Remove everything a committed world created (children first)."""
    from sqlalchemy import delete

    from app.db.models.blockchain import BlockchainReceipt
    from app.db.models.driver_substitutions import (
        DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionCorrection,
        DriverSubstitutionNotice, DriverSubstitutionOperation, DriverSubstitutionUpload, LateDriverEvidence,
        LateDriverEvidenceArtifact,
    )
    from app.db.models.driver_substitutions import DriverSubstitutionRequest as Request
    from app.db.models.evidence import EvidenceArtifact
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.transit import Checkpoint, TripException
    from app.db.models.trips import TripTrailer

    async with sessionmaker() as db:
        trip_ids = list((await db.execute(
            select(Trip.id).where(Trip.operator_organization_id == world.org_id)
        )).scalars())
        horse_ids = list((await db.execute(
            select(Trip.horse_id).where(Trip.operator_organization_id == world.org_id)
        )).scalars())
        if trip_ids:
            request_ids = select(Request.id).where(Request.trip_id.in_(trip_ids))
            await db.execute(delete(TripException).where(TripException.trip_id.in_(trip_ids)))
            late_ids = select(LateDriverEvidence.id).where(LateDriverEvidence.trip_id.in_(trip_ids))
            await db.execute(delete(DriverSubstitutionOperation).where(
                DriverSubstitutionOperation.request_id.in_(request_ids)
                | DriverSubstitutionOperation.late_evidence_id.in_(late_ids)
                | DriverSubstitutionOperation.actor_driver_id.in_([world.a, world.b, world.c, world.d])
                | (DriverSubstitutionOperation.actor_user_id == world.user_id)
            ))
            await db.execute(delete(LateDriverEvidenceArtifact).where(LateDriverEvidenceArtifact.late_evidence_id.in_(late_ids)))
            await db.execute(delete(LateDriverEvidence).where(LateDriverEvidence.trip_id.in_(trip_ids)))
            await db.execute(delete(DriverSubstitutionUpload).where(DriverSubstitutionUpload.trip_id.in_(trip_ids)))
            await db.execute(delete(DriverSubstitutionNotice).where(DriverSubstitutionNotice.request_id.in_(request_ids)))
            await db.execute(delete(DriverSubstitutionConfirmationArtifact).where(
                DriverSubstitutionConfirmationArtifact.confirmation_id.in_(
                    select(DriverSubstitutionConfirmation.id).where(DriverSubstitutionConfirmation.request_id.in_(request_ids))
                )
            ))
            await db.execute(delete(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id.in_(request_ids)))
            await db.execute(delete(DriverSubstitutionCorrection).where(
                DriverSubstitutionCorrection.substitution_id.in_(
                    select(DriverSubstitution.id).where(DriverSubstitution.trip_id.in_(trip_ids))
                )
            ))
            await db.execute(delete(DriverSubstitution).where(DriverSubstitution.trip_id.in_(trip_ids)))
            await db.execute(delete(Request).where(Request.trip_id.in_(trip_ids)))
            await db.execute(delete(Checkpoint).where(Checkpoint.trip_id.in_(trip_ids)))
            await db.execute(delete(TripException).where(TripException.trip_id.in_(trip_ids)))
            await db.execute(delete(PhaseEvent).where(PhaseEvent.trip_id.in_(trip_ids)))
            await db.execute(delete(BlockchainReceipt).where(BlockchainReceipt.trip_id.in_(trip_ids)))
            await db.execute(delete(EvidenceArtifact).where(EvidenceArtifact.trip_id.in_(trip_ids)))
            await db.execute(delete(TripTrailer).where(TripTrailer.trip_id.in_(trip_ids)))
            await db.execute(delete(TripStop).where(TripStop.trip_id.in_(trip_ids)))
            await db.execute(delete(Trip).where(Trip.id.in_(trip_ids)))
        await db.execute(delete(Vehicle).where(Vehicle.id.in_({*horse_ids, world.horse_id})))
        await db.execute(delete(Driver).where(Driver.id.in_([world.a, world.b, world.c, world.d])))
        await db.execute(delete(User).where(User.id == world.user_id))
        await db.execute(delete(Precinct).where(Precinct.id.in_([world.origin_id, world.dest_id])))
        await db.execute(delete(Organization).where(
            Organization.id.in_([world.org_id, world.client_org_id, world.other_org_id])
        ))
        await db.commit()
