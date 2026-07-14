"""Integration tests: Pydantic field constraints on vehicle create/update.

Confirms invalid input (over-length registration, malformed VIN, etc.) is
rejected with a clean 422 before it ever reaches Postgres — previously an
over-length VIN reached asyncpg and surfaced as a raw 500
(StringDataRightTruncationError).

Uses DEMO_MODE auth (Bearer demo) consistent with the rest of the integration
suite. PATCH on a critical field (registration, vin_number) triggers Hedera
anchoring, so HederaService is patched for the valid-update-on-critical-field
cases, matching the pattern in test_vehicles_cosmetic_diff.py.
"""

from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import _DEMO_ORG_ID
from app.blockchain.hedera import HederaReceipt
from app.db.models.enums import OrganizationType, VehicleType
from app.db.models.organisations import Organization
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

_VALID_VIN = "1HGCM82633A004352"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    async def _get_db():
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_org(db_session: AsyncSession) -> None:
    org = Organization(
        id=_DEMO_ORG_ID,
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add(org)
    await db_session.flush()


@pytest_asyncio.fixture
async def seed_vehicle(db_session: AsyncSession, seed_org: None) -> Vehicle:
    vehicle = Vehicle(
        organization_id=_DEMO_ORG_ID,
        registration="CA 100-001",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-VALIDATION-001",
    )
    db_session.add(vehicle)
    await db_session.flush()
    return vehicle


def _fake_hedera_receipt() -> HederaReceipt:
    return HederaReceipt(
        topic_id="0.0.12345",
        sequence_number=1,
        consensus_timestamp=None,
        transaction_id="0.0.12345@1715865603.0",
    )


# --- POST /api/v1/vehicles ---------------------------------------------------


async def test_create_vehicle_overlength_vin_returns_422(seed_org: None) -> None:
    payload = {
        "registration": "CA 200-002",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-VIN-LONG",
        "vin_number": "1HGCM82633A0043521",  # 18 chars
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_nonalphanumeric_vin_returns_422(seed_org: None) -> None:
    payload = {
        "registration": "CA 200-003",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-VIN-BAD-CHAR",
        "vin_number": "1HGCM82633A00435!",  # 17 chars but contains "!"
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_shortlength_vin_returns_422(seed_org: None) -> None:
    payload = {
        "registration": "CA 200-004",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-VIN-SHORT",
        "vin_number": "1HGCM82633A0043",  # 16 chars
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_overlength_registration_returns_422(seed_org: None) -> None:
    payload = {
        "registration": "R" * 51,
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-REG-LONG",
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_valid_vin_returns_201(seed_org: None) -> None:
    payload = {
        "registration": "CA 200-005",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-VIN-VALID",
        "vin_number": _VALID_VIN,
    }

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.post(
                "/api/v1/vehicles",
                json=payload,
                headers={"Authorization": "Bearer demo"},
            )

    assert resp.status_code == 201
    body = resp.json()
    assert body["vin_number"] == _VALID_VIN


async def test_create_vehicle_invalid_year_returns_422(seed_org: None) -> None:
    payload = {
        "registration": "CA 200-006",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-YEAR-BAD",
        "year": 1899,
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_nonpositive_gvm_returns_422(seed_org: None) -> None:
    payload = {
        "registration": "CA 200-007",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-GVM-BAD",
        "gross_vehicle_mass_kg": 0,
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_create_vehicle_invalid_vin_does_not_persist_row(
    db_session: AsyncSession, seed_org: None,
) -> None:
    """A 422 on create must not leave a row behind."""
    payload = {
        "registration": "CA 200-008",
        "vehicle_type": "horse",
        "pulsit_device_id": "PLT-VIN-NOPERSIST",
        "vin_number": "TOO-SHORT-VIN",
    }

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json=payload,
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 422

    rows = (
        await db_session.execute(
            select(Vehicle).where(Vehicle.pulsit_device_id == "PLT-VIN-NOPERSIST")
        )
    ).scalars().all()
    assert rows == []


# --- PATCH /api/v1/vehicles/{id} --------------------------------------------


async def test_update_vehicle_overlength_vin_returns_422(seed_vehicle: Vehicle) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{seed_vehicle.id}",
            json={"vin_number": "1HGCM82633A0043521"},  # 18 chars
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_update_vehicle_nonalphanumeric_vin_returns_422(seed_vehicle: Vehicle) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{seed_vehicle.id}",
            json={"vin_number": "1HGCM82633A00435!"},  # 17 chars, invalid char
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_update_vehicle_wronglength_vin_returns_422(seed_vehicle: Vehicle) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{seed_vehicle.id}",
            json={"vin_number": "SHORTVIN123"},  # 11 chars
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_update_vehicle_overlength_registration_returns_422(seed_vehicle: Vehicle) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{seed_vehicle.id}",
            json={"registration": "R" * 51},
            headers={"Authorization": "Bearer demo"},
        )

    assert resp.status_code == 422


async def test_update_vehicle_valid_vin_returns_200(seed_vehicle: Vehicle) -> None:
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.patch(
                f"/api/v1/vehicles/{seed_vehicle.id}",
                json={"vin_number": _VALID_VIN},
                headers={"Authorization": "Bearer demo"},
            )

    assert resp.status_code == 200
    assert resp.json()["vin_number"] == _VALID_VIN


async def test_update_vehicle_invalid_vin_leaves_db_state_unchanged(
    db_session: AsyncSession, seed_vehicle: Vehicle,
) -> None:
    """A 422 on PATCH must not partially write the rejected field."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{seed_vehicle.id}",
            json={"vin_number": "NOT-VALID-VIN!!"},
            headers={"Authorization": "Bearer demo"},
        )
    assert resp.status_code == 422

    db_session.expire_all()
    refreshed = (
        await db_session.execute(select(Vehicle).where(Vehicle.id == seed_vehicle.id))
    ).scalar_one()
    assert refreshed.vin_number is None
    assert refreshed.registration == "CA 100-001"
