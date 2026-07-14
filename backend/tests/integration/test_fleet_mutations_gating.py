"""Integration tests: fleet mutation endpoints (POST/PATCH drivers & vehicles) are gated
to admin_dispatcher role.

These tests are intentionally written BEFORE the dependency swap. Tests 1–4 assert 403
but will FAIL until POST /drivers, PATCH /drivers/{id}, POST /vehicles, and
PATCH /vehicles/{id} are updated to use `require_admin_dispatcher` instead of
`get_current_dispatcher`. Tests 5–7 verify that the admin path and the read-only
list path work correctly.

Service functions are patched with AsyncMock where the endpoint would normally reach the
DB, so no real database is required for the succeeding tests.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.db.models.enums import DispatcherRole, IdvsStatus, VehicleType
from app.main import app
from app.schemas.people import DriverRead, UserRead
from app.schemas.vehicles import VehicleRead

# UUIDs in the 0004 namespace — distinct from other test files (0003, etc.)
_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_ORG_ID = uuid.UUID("00000000-0000-0000-0004-000000000001")
_USER_ID = uuid.UUID("00000000-0000-0000-0004-000000000002")
_DRIVER_ID = uuid.UUID("00000000-0000-0000-0004-000000000003")
_VEHICLE_ID = uuid.UUID("00000000-0000-0000-0004-000000000004")
_OTHER_DRIVER_ID = uuid.UUID("00000000-0000-0000-0004-000000000005")


def _make_user(role: DispatcherRole) -> UserRead:
    return UserRead(
        id=_USER_ID,
        organization_id=_ORG_ID,
        email="test@fp.co.za",
        full_name="Test User",
        is_active=True,
        created_at=_NOW,
        updated_at=_NOW,
        role=role,
    )


_DISPATCHER_USER = _make_user(DispatcherRole.DISPATCHER)
_ADMIN_USER = _make_user(DispatcherRole.ADMIN_DISPATCHER)


def _fake_driver_read() -> DriverRead:
    return DriverRead.model_construct(
        id=_DRIVER_ID,
        organization_id=_ORG_ID,
        full_name="Sipho Dlamini",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        license_expiry=None,
        is_active=True,
        idvs_status=IdvsStatus.PENDING,
        idvs_last_verified_at=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _fake_vehicle_read() -> VehicleRead:
    return VehicleRead.model_construct(
        id=_VEHICLE_ID,
        organization_id=_ORG_ID,
        registration="CA 123-456",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-HORSE-001",
        is_active=True,
        make=None,
        model=None,
        year=None,
        vin_number=None,
        licence_disc_expiry=None,
        gross_vehicle_mass_kg=None,
        length_m=None,
        created_at=_NOW,
    )


@pytest.fixture(autouse=True)
def clear_dep_overrides():
    yield
    app.dependency_overrides.clear()


# ── POST /drivers — non-admin should be forbidden ─────────────────────────────


async def test_create_driver_non_admin_forbidden() -> None:
    # No service mock: 403 should fire before the service is called.
    # This test FAILS until POST /drivers is gated with require_admin_dispatcher.
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/drivers",
            json={
                "full_name": "Sipho Dlamini",
                "id_number": "8001015009087",
                "phone_number": "+27821234567",
                "license_number": "DRV-001",
            },
            headers={"Authorization": "Bearer dummy"},
        )

    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── PATCH /drivers/{id} — non-admin should be forbidden ───────────────────────


async def test_update_driver_non_admin_forbidden() -> None:
    # No service mock: 403 should fire before the service is called.
    # This test FAILS until PATCH /drivers/{id} is gated with require_admin_dispatcher.
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/drivers/{_OTHER_DRIVER_ID}",
            json={"full_name": "Updated"},
            headers={"Authorization": "Bearer dummy"},
        )

    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── POST /vehicles — non-admin should be forbidden ────────────────────────────


async def test_create_vehicle_non_admin_forbidden() -> None:
    # No service mock: 403 should fire before the service is called.
    # This test FAILS until POST /vehicles is gated with require_admin_dispatcher.
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.post(
            "/api/v1/vehicles",
            json={
                "registration": "CA 000-NEW",
                "vehicle_type": "horse",
                "pulsit_device_id": "PLT-X",
            },
            headers={"Authorization": "Bearer dummy"},
        )

    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── PATCH /vehicles/{id} — non-admin should be forbidden ──────────────────────


async def test_update_vehicle_non_admin_forbidden() -> None:
    # No service mock: 403 should fire before the service is called.
    # This test FAILS until PATCH /vehicles/{id} is gated with require_admin_dispatcher.
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
    ) as client:
        resp = await client.patch(
            f"/api/v1/vehicles/{_VEHICLE_ID}",
            json={"make": "Updated"},
            headers={"Authorization": "Bearer dummy"},
        )

    assert resp.status_code == 403
    assert "Admin dispatcher role required" in resp.json()["detail"]


# ── POST /drivers — admin should succeed ──────────────────────────────────────


async def test_create_driver_admin_succeeds() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.drivers.create_driver",
        new_callable=AsyncMock,
        return_value=_fake_driver_read(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.post(
                "/api/v1/drivers",
                json={
                    "full_name": "Sipho Dlamini",
                    "id_number": "8001015009087",
                    "phone_number": "+27821234567",
                    "license_number": "DRV-001",
                },
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 201
    assert resp.json()["full_name"] == "Sipho Dlamini"


# ── PATCH /vehicles/{id} — admin should succeed ───────────────────────────────


async def test_update_vehicle_admin_succeeds() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.vehicles.update_vehicle",
        new_callable=AsyncMock,
        return_value=_fake_vehicle_read(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.patch(
                f"/api/v1/vehicles/{_VEHICLE_ID}",
                json={"make": "Volvo"},
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert resp.json()["registration"] == "CA 123-456"


# ── GET /drivers — non-admin should always be allowed ─────────────────────────


async def test_list_drivers_non_admin_allowed() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    with patch(
        "app.api.v1.endpoints.drivers.list_drivers",
        new_callable=AsyncMock,
        return_value=[],
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/drivers",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert resp.json() == []
