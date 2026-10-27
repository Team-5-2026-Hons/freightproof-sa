"""Seed helpers shared by the FP-290 evidence-anchor integration tests."""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    ArtifactType, IdvsStatus, OrganizationType, TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle


@dataclass
class World:
    org: Organization
    user: User
    driver: Driver
    trip: Trip

    def __post_init__(self) -> None:
        self.trip_id, self.driver_id, self.org_id = self.trip.id, self.driver.id, self.org.id


def file_hash(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


async def seed_world(db: AsyncSession, *, tag: str = "A") -> World:
    org = Organization(id=uuid.uuid4(), name=f"Org {tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name=f"Client {tag}", org_type=OrganizationType.PRINCIPAL)
    db.add_all([org, client_org])
    await db.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"d-{uuid.uuid4()}@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number=str(uuid.uuid4().int)[:13], phone_number="+27821234567",
        license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"R{uuid.uuid4().hex[:6]}", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db.add_all([user, driver, horse, origin, dest])
    await db.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:8]}", order_number="ORD-1",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db.add(trip)
    await db.flush()
    return World(org=org, user=user, driver=driver, trip=trip)


async def make_artifact(db: AsyncSession, trip_id: uuid.UUID, label: str = "photo") -> EvidenceArtifact:
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash=file_hash(f"{label}-{uuid.uuid4()}"), mime_type="image/jpeg",
        captured_at=datetime.now(UTC),
    )
    db.add(artifact)
    await db.flush()
    return artifact
