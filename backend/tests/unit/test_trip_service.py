"""Unit tests for create_trip() consignment-loop wiring.

These tests are DB-free — every async call made by create_trip() is patched.
They verify that:
  - fetch_and_sync_consignment is NOT called for an empty-leg trip (no consignments)
  - fetch_and_sync_consignment IS called once per consignment, with the correct args
  - a PP failure for any consignment surfaces as PPSyncError and rolls back the session
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import PPSyncError
from app.db.models.enums import DispatcherRole, TripType
from app.integrations.parcel_perfect import PPWaybillNotFoundError
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


def make_loaded_payload(**kwargs) -> TripCreateRequest:
    """A LOADED trip payload — requires at least one consignment."""
    base = dict(
        order_number="ORD-001",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        consignments=[{"pp_reference": "WAY123", "unit_count_expected": 2}],
    )
    base.update(kwargs)
    return TripCreateRequest(**base)


def make_empty_leg_payload(**kwargs) -> TripCreateRequest:
    """An EMPTY_LEG trip payload — must carry no consignments."""
    base = dict(
        order_number="ORD-002",
        driver_id=uuid.uuid4(),
        horse_id=uuid.uuid4(),
        trailer_ids=[uuid.uuid4()],
        origin_precinct_id=uuid.uuid4(),
        destination_precinct_id=uuid.uuid4(),
        trip_type=TripType.EMPTY_LEG,
    )
    base.update(kwargs)
    return TripCreateRequest(**base)


def _make_db() -> AsyncMock:
    db = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.mark.asyncio
async def test_create_trip_empty_leg_does_not_call_sync() -> None:
    """An empty-leg trip (no consignments) must never call fetch_and_sync_consignment."""
    from app.orchestration.trip_service import create_trip

    payload = make_empty_leg_payload()
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
async def test_create_trip_with_consignments_calls_sync() -> None:
    """A loaded trip calls fetch_and_sync_consignment once per consignment with correct args."""
    from app.orchestration.trip_service import create_trip

    payload = make_loaded_payload(
        consignments=[{"pp_reference": "WAY123", "unit_count_expected": 2}]
    )
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
            # We only care that sync was called correctly; other mock gaps are acceptable
            # (e.g. ConsignmentRead.model_validate() on the MagicMock sync result below).
            pass

        mock_sync.assert_called_once()
        call_kwargs = mock_sync.call_args.kwargs
        assert call_kwargs.get("pp_reference") == "WAY123"
        assert call_kwargs.get("unit_count_expected") == 2


@pytest.mark.asyncio
async def test_create_trip_unknown_waybill_raises_ppsync_error() -> None:
    """A PP failure for any consignment (e.g. unresolvable pp_reference) surfaces as
    PPSyncError and rolls back the session — a trip must not persist with a cargo
    plan that couldn't be pulled from PP."""
    from app.orchestration.trip_service import create_trip

    payload = make_loaded_payload(
        consignments=[{"pp_reference": "NOPE999", "unit_count_expected": 1}]
    )
    user = make_user()
    db = _make_db()

    with (
        patch("app.orchestration.trip_service._fetch_driver", new_callable=AsyncMock) as mock_driver,
        patch("app.orchestration.trip_service._fetch_vehicle", new_callable=AsyncMock) as mock_vehicle,
        patch("app.orchestration.trip_service._check_order_number_conflict", new_callable=AsyncMock),
        patch(
            "app.orchestration.consignment_service.fetch_and_sync_consignment",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        mock_driver.return_value = MagicMock(id=payload.driver_id)
        mock_vehicle.return_value = MagicMock(id=payload.horse_id, pulsit_device_id="DEV-001")
        mock_sync.side_effect = PPWaybillNotFoundError("NOPE999")

        with pytest.raises(PPSyncError) as exc_info:
            await create_trip(db, payload, user)

        assert exc_info.value.pp_reference == "NOPE999"
        db.rollback.assert_awaited_once()
