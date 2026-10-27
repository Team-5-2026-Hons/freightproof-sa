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
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, AsyncGenerator
from unittest.mock import Mock

import pytest
import pytest_asyncio
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

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

settings.RATE_LIMIT_ENABLED = False

settings.DRIVER_SUBSTITUTIONS_ENABLED = True

_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
_BASE_TEST_DATABASE_URL = settings.TEST_DATABASE_URL
_REDIS_WORKER_DATABASES = 15
if _XDIST_WORKER and settings.TEST_DATABASE_URL:
    _base_test_url = make_url(_BASE_TEST_DATABASE_URL)
    settings.TEST_DATABASE_URL = _base_test_url.set(
        database=f"{_base_test_url.database}_{_XDIST_WORKER}"
    ).render_as_string(hide_password=False)
    _worker_number = int(_XDIST_WORKER.removeprefix("gw"))
    settings.REDIS_URL = str(make_url(settings.REDIS_URL).set(
        database=str(1 + _worker_number % _REDIS_WORKER_DATABASES)
    ).render_as_string(hide_password=False))


async def _ensure_database_exists(url: str) -> None:
    """Create the worker's test database on first use, from a connection to the base one."""
    target = make_url(url)
    engine = create_async_engine(_BASE_TEST_DATABASE_URL, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target.database},
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    finally:
        await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def isolate_anchor_dispatch(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[None, None]:
    """Never publish test phase IDs to the development broker; drain per-loop work.

    Module-specific capture/failure fixtures replace this stub when they test the
    queue boundary. Draining before pytest closes the loop keeps tasks from leaking
    into the next test without changing the application's async dispatch behavior.
    """
    from app.orchestration.phases.anchor_dispatch import _BACKGROUND_ANCHOR_TASKS
    from app.tasks.blockchain import anchor_phase_event_task

    from app.orchestration.evidence_anchors.dispatch import _BACKGROUND_EVIDENCE_TASKS
    from app.tasks.evidence_anchors import anchor_event_task, register_evidence_publisher

    monkeypatch.setattr(anchor_phase_event_task, "delay", Mock(return_value=None))
    monkeypatch.setattr(anchor_event_task, "delay", Mock(return_value=None))
    register_evidence_publisher()
    from app.orchestration.substitutions.anchors import _BACKGROUND_CUSTODY_TASKS
    from app.tasks.driver_substitutions import anchor_record_task, register_custody_publisher

    monkeypatch.setattr(anchor_record_task, "delay", Mock(return_value=None))
    register_custody_publisher()
    yield
    while _BACKGROUND_ANCHOR_TASKS or _BACKGROUND_EVIDENCE_TASKS or _BACKGROUND_CUSTODY_TASKS:
        await asyncio.gather(
            *tuple(_BACKGROUND_ANCHOR_TASKS), *tuple(_BACKGROUND_EVIDENCE_TASKS), *tuple(_BACKGROUND_CUSTODY_TASKS),
        )


@pytest_asyncio.fixture(autouse=True)
async def isolate_sendgrid(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never let a test reach the real SendGrid API: issuing an audit pack with a
    recipient email now mails its viewer password automatically (FP-291), so every such
    test would otherwise make a live network call. Fails the same way a SendGrid outage
    would (fail-open in lifecycle.issue_audit_pack, nothing logged) rather than hanging
    on an unreachable host or depending on what a real request happens to return.

    A test that needs the real send path (test_audit_pack_viewer_password.py's `outbox`
    fixture) overrides this with its own monkeypatch of the same target.
    """
    from app.core.exceptions import EmailUnavailableError

    async def fake_send(*, to_address: str, subject: str, body: str) -> None:
        raise EmailUnavailableError("SendGrid is not reachable in tests")

    monkeypatch.setattr("app.orchestration.audit_packs.viewer_password.send_plain_text_email", fake_send)

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


@contextmanager
def production_settings(**overrides: Any):
    """Run a block with settings that look like a VALID production deployment.

    app.main calls enforce_production_config() at import time, so any test that flips
    ENVIRONMENT to "production" and reloads it must also satisfy the production
    preconditions — otherwise the reload raises ProductionConfigError and the test fails
    for a reason that has nothing to do with what it is checking.

    That coupling is deliberate, not an inconvenience to work around: a test simulating
    production should simulate a production that is actually allowed to serve. The
    defaults below are the minimum that passes; pass overrides for whatever the test is
    actually about.

    Every touched field is restored on exit, including __pydantic_fields_set__ — assigning
    to a settings field mutates it, and leaving that changed would let one test silently
    satisfy another's explicit-configuration rule.
    """
    defaults: dict[str, Any] = {
        "ENVIRONMENT": "production",
        "ALLOWED_ORIGINS": ["https://www.freightproof.co.za"],
        "HANDOVER_RECEIVER_BASE_URL": "https://receiver.freightproof.co.za",
        "IDVS_USE_MOCK": True,
        "RATE_LIMIT_ENABLED": True,
        "RATE_LIMIT_TRUST_PROXY_HEADERS": True,
    }
    values = {**defaults, **overrides}

    originals = {name: getattr(settings, name) for name in values}
    original_fields_set = set(settings.model_fields_set)

    for name, value in values.items():
        setattr(settings, name, value)
    try:
        yield settings
    finally:
        for name, value in originals.items():
            setattr(settings, name, value)
        settings.__pydantic_fields_set__ = original_fields_set


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}



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



@pytest.fixture(scope="session")
def test_engine():
    """Create tables once per session and yield the async engine.

    NullPool prevents connections being held by the engine itself, avoiding
    event-loop binding issues across function-scoped test sessions.
    """
    if not settings.TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set — skipping integration tests")

    if _XDIST_WORKER:
        asyncio.run(_ensure_database_exists(settings.TEST_DATABASE_URL))
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
    created without a Parcel Perfect reference. phases.blocking must never block it.
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
