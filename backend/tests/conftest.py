"""Shared fixtures for unit and integration tests.

Two fixture families live here:

  JWT helpers (make_token, auth_header, make_jwks, client): for endpoint tests
  that need a real HTTP client with signed tokens. The client fixture
  monkeypatches _get_jwks so token verification uses a test-generated EC key
  pair instead of fetching Supabase's live JWKS endpoint.

  DB session fixtures (test_engine, db_session): for integration tests that need
  direct DB access. Each test runs inside a rolled-back transaction so the DB is
  clean between tests. Requires TEST_DATABASE_URL in backend/.env.
"""

import asyncio
import base64
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, AsyncGenerator

import pytest
import pytest_asyncio
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

# Provide throwaway config values when no backend/.env is present (e.g. CI), so the app's
# Settings() can instantiate during tests without real secrets. Gated on .env absence:
# local dev with a real .env is unaffected, and setdefault never overrides a value already
# in the environment (so a real CI secret like SUPABASE_SERVICE_ROLE_KEY still wins). The DB
# integration tests still skip unless TEST_DATABASE_URL is supplied.
if not (Path(__file__).resolve().parent.parent / ".env").exists():
    for _key, _val in {
        "DATABASE_URL": "postgresql+asyncpg://test:test@localhost/test",
        "REDIS_URL": "redis://localhost:6379/0",
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_ANON_KEY": "test-anon-key",
        "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        "HEDERA_ACCOUNT_ID": "0.0.0",
        "HEDERA_PRIVATE_KEY": "test-hedera-key",
        "TWILIO_ACCOUNT_SID": "test-twilio-sid",
        "TWILIO_AUTH_TOKEN": "test-twilio-token",
        "TWILIO_FROM_NUMBER": "+10000000000",
        "SENDGRID_API_KEY": "test-sendgrid-key",
        "SENDGRID_FROM_EMAIL": "test@example.com",
    }.items():
        os.environ.setdefault(_key, _val)

from app.core.config import settings  # noqa: E402
from app.db.models import Base  # noqa: E402
from app.main import app  # noqa: E402

# ── Test EC key pair (generated once per process) ─────────────────────────────
# Used to sign test JWTs with ES256, mirroring how Supabase signs real tokens.

_TEST_EC_KEY = generate_private_key(SECP256R1(), default_backend())
_TEST_PRIVATE_PEM = _TEST_EC_KEY.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)

TEST_KID = "test-kid-fp-0001"
_AUDIENCE = "authenticated"


def _b64url(n: int, byte_length: int = 32) -> str:
    """Encode an integer as a base64url string (used for EC coordinate encoding)."""
    return base64.urlsafe_b64encode(n.to_bytes(byte_length, "big")).rstrip(b"=").decode()


def make_jwks() -> dict:
    """Return a JWKS dict containing the test EC public key.

    Passed to monkeypatch so _get_jwks() returns a controlled key during tests
    instead of making a network request to Supabase.
    """
    pub_numbers = _TEST_EC_KEY.public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "EC",
                "crv": "P-256",
                "x": _b64url(pub_numbers.x),
                "y": _b64url(pub_numbers.y),
                "kid": TEST_KID,
                "alg": "ES256",
                "use": "sig",
            }
        ]
    }


def make_token(
    *,
    sub: str | None = None,
    role: str = "dispatcher",
    org_id: str | None = None,
    expires_in: int = 3600,
    session_id: str | None = None,
    issued_at: datetime | None = None,
) -> str:
    """Return an ES256-signed JWT matching the Supabase Auth payload shape.

    role and org_id go into app_metadata to mirror production tokens.
    Pass expires_in=-1 to produce an already-expired token.
    """
    now = datetime.now(UTC)
    # session_id/iat back the one-device-per-driver rule (app/auth/sessions.py). Each
    # call gets a fresh session by default so unrelated tests never collide over one
    # driver's session row; pass them explicitly to model two devices.
    issued = issued_at or now
    payload = {
        "session_id": session_id or str(uuid.uuid4()),
        "aud": _AUDIENCE,
        "iss": "https://test.supabase.co/auth/v1",
        "sub": sub or str(uuid.uuid4()),
        "email": "dispatcher@test.co.za",
        "role": "authenticated",
        "app_metadata": {
            "role": role,
            "org_id": org_id or str(uuid.uuid4()),
        },
        "iat": int(issued.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(
        payload,
        _TEST_PRIVATE_PEM,
        algorithm="ES256",
        headers={"kid": TEST_KID},
    )


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── In-process HTTP client ─────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def client(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient wired directly to the FastAPI app via ASGITransport.

    Patches _get_jwks so token verification uses the test EC key pair instead
    of fetching Supabase's live JWKS endpoint.
    """
    monkeypatch.setattr("app.auth.dependencies._get_jwks", make_jwks)

    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as ac:
        yield ac


# ── DB session fixtures ────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def test_engine():
    """Create tables once per session and yield the async engine.

    NullPool prevents connections being held by the engine itself, avoiding
    event-loop binding issues across function-scoped test sessions.
    """
    if not settings.TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set — skipping integration tests")

    engine = create_async_engine(settings.TEST_DATABASE_URL, poolclass=NullPool)

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def _drop() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_create())
    yield engine
    asyncio.run(_drop())


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a rolled-back AsyncSession for each test — leaves DB clean."""
    async with test_engine.connect() as conn:
        transaction = await conn.begin()
        session = AsyncSession(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()


class FakeMockStateStore:
    """Dict-backed MockStateStore, so tests never need a real Redis.

    One definition rather than a copy per test module. MockStateStore is a
    structural Protocol: nothing asserts that a fake still satisfies it, so adding
    a method to the contract used to break every copy at runtime with an
    AttributeError that neither ruff nor mypy could see coming. Extending this one
    class is now the whole migration.

    The fixture that injects it stays local to each test module — what gets
    monkeypatched genuinely differs (scan_feed, parcel_perfect, or both), and that
    wiring is the part each test should keep saying out loud.
    """

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}
        # Counts batched reads, so a test can assert the phase gate stays at one
        # round trip per call however many consignments a trip carries.
        self.batch_calls = 0

    async def get_json(self, key: str) -> dict[str, Any] | None:
        return self.data.get(key)

    async def get_many_json(self, keys: list[str]) -> list[dict[str, Any] | None]:
        self.batch_calls += 1
        return [self.data.get(key) for key in keys]

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


# ── Warehouse-scan fixtures ─────────────────────────────────────────────────────
# Shared by test_scan_service.py and test_phase_gate.py, so both agree on one
# seeded trip shape instead of drifting apart in duplicated fixture bodies.


@pytest.fixture
async def seeded(db_session):
    """A one-stop trip with one 3-parcel consignment picked up at that stop."""
    from app.db.models.enums import (
        IdvsStatus, OrganizationType, ParcelStatus, TripStatus, VehicleType,
    )
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.trips import Consignment, Parcel, Trip, TripStop
    from app.db.models.vehicles import Vehicle

    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    consignment = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add(consignment)
    await db_session.flush()

    barcodes = ["WAY0010001", "WAY0010002", "WAY0010003"]
    for barcode in barcodes:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id,
            barcode=barcode, status=ParcelStatus.PENDING,
        ))
    await db_session.flush()

    return {"trip": trip, "stop": stop, "consignment": consignment, "barcodes": barcodes}


@pytest.fixture
async def empty_trip(db_session):
    """A trip with TripStop rows but no Consignment rows — no PP reference at all.

    manifest.ts documents this shape as common and normal, not a failure: a trip
    created without a Parcel Perfect reference. phase_gate must never block it.
    """
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.trips import Trip, TripStop
    from app.db.models.vehicles import Vehicle

    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    return {"trip": trip, "stop": stop}


@pytest.fixture
async def xdock_trip(db_session):
    """A cross-dock trip: two pickup stops, one consignment loaded at each."""
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.trips import Consignment, Trip, TripStop
    from app.db.models.vehicles import Vehicle

    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct_1 = Precinct(
        id=uuid.uuid4(), name="Origin A", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    precinct_2 = Precinct(
        id=uuid.uuid4(), name="Origin B", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct_1, precinct_2])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop_1 = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct_1.id, sequence=1)
    stop_2 = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct_2.id, sequence=2)
    db_session.add_all([stop_1, stop_2])
    await db_session.flush()

    consignment_1 = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=3, pickup_stop_id=stop_1.id, delivery_stop_id=stop_1.id,
    )
    consignment_2 = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY002",
        parcel_count_expected=3, pickup_stop_id=stop_2.id, delivery_stop_id=stop_2.id,
    )
    db_session.add_all([consignment_1, consignment_2])
    await db_session.flush()

    return {"trip": trip, "stop_1": stop_1, "stop_2": stop_2}


@pytest.fixture
async def two_waybill_stop(db_session):
    """One stop serving two waybills — stays blocked while either session is open."""
    from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
    from app.db.models.organisations import Organization, Precinct
    from app.db.models.people import Driver, User
    from app.db.models.trips import Consignment, Trip, TripStop
    from app.db.models.vehicles import Vehicle

    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    precinct = Precinct(
        id=uuid.uuid4(), name="Origin", principal_organization_id=org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([user, driver, horse, precinct])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}", order_number="ORD-1",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    consignment_1 = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY001",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    consignment_2 = Consignment(
        id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference="WAY002",
        parcel_count_expected=3, pickup_stop_id=stop.id, delivery_stop_id=stop.id,
    )
    db_session.add_all([consignment_1, consignment_2])
    await db_session.flush()

    return {"trip": trip, "stop": stop}
