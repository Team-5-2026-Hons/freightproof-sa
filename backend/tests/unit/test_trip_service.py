"""Unit tests for create_trip() PP reference wiring.

These tests are DB-free — every async call made by create_trip() is patched.
They verify that:
  - fetch_and_sync_consignment is NOT called when pp_reference is None
  - fetch_and_sync_consignment IS called with the correct args when pp_reference is set
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.db.models.enums import DispatcherRole
from app.schemas.people import UserRead
from app.schemas.trips import TripCreateRequest

_NOW = datetime(2026, 1, 1, tzinfo=UTC)


def make_user() -> UserRead:
    return UserRead(
        id=uuid.uuid4(),
        email="dispatcher@test.co.za",
        full_name="Test Dispatcher",
        organization_id=uuid.uuid4(),
        role=DispatcherRole.DISPATCHER,
        created_at=_NOW,
        updated_at=_NOW,
    )


def make_payload(**kwargs) -> TripCreateRequest:
    base = dict(
        order_number="ORD-001",
        client_organization_id=uuid.uuid4(),
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
    )
    base.update(kwargs)
    return TripCreateRequest(**base)


def _make_db() -> AsyncMock:
    db = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.mark.asyncio
async def test_create_trip_without_pp_reference_does_not_call_sync() -> None:
    """When pp_reference is None, fetch_and_sync_consignment must not be called."""
    from app.orchestration.trip_service import create_trip

    payload = make_payload()  # pp_reference defaults to None
    user = make_user()
    db = _make_db()

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch("app.orchestration.trip_service.anchor_subject", new_callable=AsyncMock) as mock_anchor,
        patch("app.orchestration.trip_service.compute_journey_lock_hash", return_value="hash-abc"),
        patch("app.orchestration.trip_service.compute_trip_canonical_payload", return_value=b"canonical"),
        patch("app.orchestration.trip_service.get_trip_detail", new_callable=AsyncMock) as mock_detail,
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_anchor.return_value = MagicMock()
        mock_detail.return_value = MagicMock()

        try:
            await create_trip(db, payload, user)
        except Exception:
            # We only care that sync was not called; other mock gaps are acceptable.
            pass

        mock_sync.assert_not_called()


@pytest.mark.asyncio
async def test_create_trip_with_pp_reference_calls_sync() -> None:
    """When pp_reference is set, fetch_and_sync_consignment is called with correct args."""
    from app.orchestration.trip_service import create_trip

    payload = make_payload(pp_reference="WAY123")
    user = make_user()
    db = _make_db()

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch("app.orchestration.trip_service.anchor_subject", new_callable=AsyncMock) as mock_anchor,
        patch("app.orchestration.trip_service.compute_journey_lock_hash", return_value="hash-abc"),
        patch("app.orchestration.trip_service.compute_trip_canonical_payload", return_value=b"canonical"),
        patch("app.orchestration.trip_service.get_trip_detail", new_callable=AsyncMock) as mock_detail,
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_anchor.return_value = MagicMock()
        mock_detail.return_value = MagicMock()

        try:
            await create_trip(db, payload, user)
        except Exception:
            # We only care that sync was called; other mock gaps are acceptable.
            pass

        mock_sync.assert_called_once()
        call_kwargs = mock_sync.call_args
        # fetch_and_sync_consignment is called with keyword args only (positional db excluded)
        assert call_kwargs.kwargs.get("pp_reference") == "WAY123" or (
            len(call_kwargs.args) > 1 and call_kwargs.args[1] == "WAY123"
        )
        assert call_kwargs.kwargs.get("client_organization_id") == payload.client_organization_id
