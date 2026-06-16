"""Integration tests: receipts stripping on detail endpoints for non-admin dispatchers.

Verifies that GET /drivers/{id}, /vehicles/{id}, and /trips/{id} return
an empty receipts list for a normal dispatcher while an admin_dispatcher
gets the full list. Service functions are patched to return a seeded fake
detail object so no DB is required.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.db.models.enums import (
    BlockchainReceiptType, DispatcherRole, IdvsStatus, SubjectType,
    TripStatus, VehicleType,
)
from app.main import app
from app.schemas.blockchain import BlockchainReceiptRead
from app.schemas.people import DriverDetailResponse, DriverRead, UserRead
from app.schemas.trips import TripDetailResponse
from app.schemas.vehicles import VehicleDetailResponse, VehicleRead

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_ORG_ID = uuid.UUID("00000000-0000-0000-0003-000000000001")
_USER_ID = uuid.UUID("00000000-0000-0000-0003-000000000002")
_OBJ_ID = uuid.UUID("00000000-0000-0000-0003-000000000003")


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


def _fake_receipt() -> BlockchainReceiptRead:
    return BlockchainReceiptRead.model_construct(
        id=uuid.uuid4(),
        subject_type=SubjectType.DRIVER,
        subject_id=_OBJ_ID,
        receipt_type=BlockchainReceiptType.DRIVER_CREATED,
        data_hash="a" * 64,
        hedera_topic_id="0.0.99999",
        hedera_sequence_number=1,
        hedera_consensus_timestamp=None,
        hedera_tx_id=None,
        created_at=_NOW,
    )


def _fake_driver_detail() -> DriverDetailResponse:
    return DriverDetailResponse.model_construct(
        id=_OBJ_ID,
        organization_id=_ORG_ID,
        full_name="Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        is_active=True,
        idvs_status=IdvsStatus.PENDING,
        idvs_last_verified_at=None,
        license_expiry=None,
        created_at=_NOW,
        updated_at=_NOW,
        events=[],
        receipts=[_fake_receipt()],
        trip_ids=[],
    )


def _fake_vehicle_detail() -> VehicleDetailResponse:
    return VehicleDetailResponse.model_construct(
        id=_OBJ_ID,
        organization_id=_ORG_ID,
        registration="CA 123 GP",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-001",
        is_active=True,
        make=None,
        model=None,
        year=None,
        vin_number=None,
        licence_disc_expiry=None,
        gross_vehicle_mass_kg=None,
        length_m=None,
        created_at=_NOW,
        events=[],
        receipts=[_fake_receipt()],
        trip_ids=[],
    )


def _fake_trip_detail() -> TripDetailResponse:
    driver = DriverRead.model_construct(
        id=_OBJ_ID,
        organization_id=_ORG_ID,
        full_name="Test Driver",
        id_number="8001015009087",
        phone_number="+27821234567",
        license_number="DRV-001",
        is_active=True,
        idvs_status=IdvsStatus.PENDING,
        idvs_last_verified_at=None,
        license_expiry=None,
        created_at=_NOW,
        updated_at=_NOW,
    )
    horse = VehicleRead.model_construct(
        id=_OBJ_ID,
        organization_id=_ORG_ID,
        registration="CA 123 GP",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="PLT-001",
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
    return TripDetailResponse.model_construct(
        id=_OBJ_ID,
        trip_reference="FP-001",
        order_number="ORD-001",
        status=TripStatus.CREATED,
        journey_lock_hash=None,
        idvs_check_status=IdvsStatus.PENDING,
        driver=driver,
        horse=horse,
        trailers=[],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        pulsit_trip_reference_id=None,
        planned_departure_at=None,
        actual_departure_at=None,
        planned_arrival_at=None,
        actual_arrival_at=None,
        closed_at=None,
        handshakes=[],
        exceptions=[],
        blockchain_receipts=[_fake_receipt()],
        created_at=_NOW,
        updated_at=_NOW,
    )


@pytest.fixture(autouse=True)
def clear_dep_overrides():
    yield
    app.dependency_overrides.clear()


# ── GET /drivers/{id} ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_driver_detail_strips_receipts_for_dispatcher() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    with patch(
        "app.api.v1.endpoints.drivers.get_driver_detail",
        new_callable=AsyncMock,
        return_value=_fake_driver_detail(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/drivers/{_OBJ_ID}",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert resp.json()["receipts"] == []


@pytest.mark.asyncio
async def test_driver_detail_exposes_receipts_for_admin() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.drivers.get_driver_detail",
        new_callable=AsyncMock,
        return_value=_fake_driver_detail(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/drivers/{_OBJ_ID}",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert len(resp.json()["receipts"]) == 1


# ── GET /vehicles/{id} ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_vehicle_detail_strips_receipts_for_dispatcher() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    with patch(
        "app.api.v1.endpoints.vehicles.get_vehicle_detail",
        new_callable=AsyncMock,
        return_value=_fake_vehicle_detail(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/vehicles/{_OBJ_ID}",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert resp.json()["receipts"] == []


@pytest.mark.asyncio
async def test_vehicle_detail_exposes_receipts_for_admin() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.vehicles.get_vehicle_detail",
        new_callable=AsyncMock,
        return_value=_fake_vehicle_detail(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/vehicles/{_OBJ_ID}",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert len(resp.json()["receipts"]) == 1


# ── GET /trips/{id} ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_trip_detail_strips_receipts_for_dispatcher() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER
    with patch(
        "app.api.v1.endpoints.trips.get_trip_detail",
        new_callable=AsyncMock,
        return_value=_fake_trip_detail(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/trips/{_OBJ_ID}",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert resp.json()["blockchain_receipts"] == []


@pytest.mark.asyncio
async def test_trip_detail_exposes_receipts_for_admin() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    with patch(
        "app.api.v1.endpoints.trips.get_trip_detail",
        new_callable=AsyncMock,
        return_value=_fake_trip_detail(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/trips/{_OBJ_ID}",
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert len(resp.json()["blockchain_receipts"]) == 1
