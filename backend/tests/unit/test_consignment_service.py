"""Unit tests for orchestration/consignment_service.py.

All tests are DB-free — the AsyncSession and get_pp_client are fully mocked.
No real network calls, no migrations, no fixtures requiring a live DB.

Test structure mirrors the pattern in test_supabase_admin.py: patch at the
module path seen by the SUT, use AsyncMock for coroutines.
"""

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.db.models.enums import ParcelStatus
from app.db.models.trips import Consignment, Parcel
from app.integrations.parcel_perfect import (
    PPContents,
    PPTrack,
    PPWaybillDetails,
    PPWaybillResponse,
)
from app.orchestration.consignment_service import fetch_and_sync_consignment

# ---------------------------------------------------------------------------
# Shared fixture data
# ---------------------------------------------------------------------------

_ORG_ID = uuid.uuid4()
_TRIP_ID = uuid.uuid4()
_PP_REF = "WAY001"


def _make_details(
    pp_reference: str = _PP_REF,
    declared_value: float | None = 500.00,
    poddate: str = "",
) -> PPWaybillDetails:
    """Build a minimal PPWaybillDetails for unit tests."""
    return PPWaybillDetails(
        waybill=pp_reference,
        waydate="01.06.2026",
        pieces=2,
        duedate="03.06.2026",
        declared_value=declared_value,
        dest_address="1 Main St",
        dest_town="CAPE TOWN",
        dest_person="Test Receiver",
        dest_contact="0210000001",
        orig_person="Test Shipper",
        orig_town="JOHANNESBURG",
        orig_address="1 Test St",
        service="ONX",
        actual_weight_kg=5.0,
        freight_total=None,
        poddate=poddate,
        failtype=None,
        client_reference="REF001",
    )


_WAYBILL = PPWaybillResponse(
    details=_make_details(),
    contents=[
        PPContents(item=1, description="Electronics", actmass=5.0, pieces=2),
    ],
    tracks=[
        PPTrack(trackno="WAY0010001", parcelno=1, item=1),
        PPTrack(trackno="WAY0010002", parcelno=2, item=1),
    ],
    wayrefs=[],
)


def make_waybill(
    pp_reference: str = _PP_REF,
    declared_value: float | None = 500.00,
    poddate: str = "",
) -> PPWaybillResponse:
    """Build a PPWaybillResponse with two tracks, allowing customisation of key fields.

    Useful when a test needs a specific declared_value or poddate to verify behaviour
    without repeating the full dataclass construction.
    """
    return PPWaybillResponse(
        details=_make_details(pp_reference, declared_value, poddate),
        contents=[
            PPContents(item=1, description="Electronics", actmass=5.0, pieces=2),
        ],
        tracks=[
            PPTrack(trackno=f"{pp_reference}0001", parcelno=1, item=1),
            PPTrack(trackno=f"{pp_reference}0002", parcelno=2, item=1),
        ],
        wayrefs=[],
    )


def _make_db_mock(
    *,
    scalar_one_or_none: object = None,
    fetchall_rows: list[tuple[str]] | None = None,
) -> MagicMock:
    """Build a minimal AsyncSession mock.

    scalar_one_or_none: returned by the first db.execute() call (Consignment lookup).
    fetchall_rows:      returned by the second db.execute() call (existing barcode query).
    """
    if fetchall_rows is None:
        fetchall_rows = []

    # Two successive execute() calls return different results:
    # 1st → consignment lookup; 2nd → barcode list.
    consignment_result = MagicMock()
    consignment_result.scalar_one_or_none.return_value = scalar_one_or_none

    barcode_result = MagicMock()
    barcode_result.fetchall.return_value = fetchall_rows

    db = MagicMock()
    # execute is a coroutine so it needs AsyncMock; side_effect alternates between results.
    db.execute = AsyncMock(side_effect=[consignment_result, barcode_result])
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _make_pp_client_patch(waybill: PPWaybillResponse = _WAYBILL) -> MagicMock:
    """Patch get_pp_client so its returned client.get_single_waybill returns waybill."""
    client = MagicMock()
    client.get_single_waybill = AsyncMock(return_value=waybill)
    factory = MagicMock(return_value=client)
    return factory


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_consignment_is_inserted():
    """First call for a pp_reference inserts a new Consignment row."""
    db = _make_db_mock(scalar_one_or_none=None, fetchall_rows=[])
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignment_service.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            client_organization_id=_ORG_ID,
            trip_id=_TRIP_ID,
        )

    # A new Consignment should have been added, not an update path.
    assert db.add.called, "db.add must be called for a new consignment"

    # The returned object must be the Consignment that was added.
    added_obj = db.add.call_args_list[0][0][0]
    assert isinstance(added_obj, Consignment)
    assert added_obj.parcel_perfect_reference == _PP_REF
    assert added_obj.parcel_count_expected == 2
    assert added_obj.trip_id == _TRIP_ID
    assert added_obj.client_organization_id == _ORG_ID

    # flush must be awaited so the FK is resolved before Parcel inserts.
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_existing_consignment_is_updated_not_duplicated():
    """Second call with same pp_reference refreshes fields but inserts no duplicate Consignment."""
    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = _TRIP_ID
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0

    # All barcodes already present — no new Parcel rows should be added.
    fetchall_rows = [("WAY0010001",), ("WAY0010002",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignment_service.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            client_organization_id=_ORG_ID,
        )

    # No new Consignment or Parcel rows should have been added.
    assert not db.add.called, "db.add must NOT be called when all rows already exist"

    # Mutable fields must be refreshed on the existing row.
    assert existing.parcel_count_expected == 2
    assert existing.pp_raw_json != {}, "pp_raw_json must be updated"

    assert result is existing


@pytest.mark.asyncio
async def test_new_parcels_inserted_for_existing_consignment():
    """PP returns 2 tracks but only 1 barcode exists — exactly 1 new Parcel is inserted."""
    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = None
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0

    # Only the first barcode is already in the DB.
    fetchall_rows = [("WAY0010001",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignment_service.get_pp_client", pp_factory):
        await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            client_organization_id=_ORG_ID,
        )

    # Exactly one Parcel add call — for the second barcode only.
    assert db.add.call_count == 1, f"Expected 1 db.add call, got {db.add.call_count}"
    added_parcel = db.add.call_args_list[0][0][0]
    assert isinstance(added_parcel, Parcel)
    assert added_parcel.barcode == "WAY0010002"
    assert added_parcel.status == ParcelStatus.PENDING
    assert added_parcel.consignment_id == existing.id


@pytest.mark.asyncio
async def test_trip_id_set_on_existing_consignment_if_none():
    """Existing consignment has trip_id=None; call with trip_id sets it."""
    new_trip_id = uuid.uuid4()

    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = None  # No trip yet
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0

    # Both barcodes already present — no new Parcel inserts.
    fetchall_rows = [("WAY0010001",), ("WAY0010002",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignment_service.get_pp_client", pp_factory):
        await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            client_organization_id=_ORG_ID,
            trip_id=new_trip_id,
        )

    # trip_id must be assigned to the previously unlinked consignment.
    assert existing.trip_id == new_trip_id


@pytest.mark.asyncio
async def test_pp_error_propagates():
    """PP raising ValueError must propagate — no DB writes should occur."""
    db = _make_db_mock()

    client = MagicMock()
    client.get_single_waybill = AsyncMock(side_effect=ValueError("PP error"))
    pp_factory = MagicMock(return_value=client)

    with patch("app.orchestration.consignment_service.get_pp_client", pp_factory):
        with pytest.raises(ValueError, match="PP error"):
            await fetch_and_sync_consignment(
                db=db,
                pp_reference=_PP_REF,
                client_organization_id=_ORG_ID,
            )

    # No DB interaction of any kind should have happened.
    assert not db.add.called, "db.add must not be called when PP raises"
    # db.execute should not have been called either (PP fails before any DB query).
    assert not db.execute.called, "db.execute must not be called when PP raises"


@pytest.mark.asyncio
async def test_declared_value_coerced_to_decimal():
    """declared_value from PP float is stored as Decimal for SQLAlchemy Numeric compatibility.

    PP returns declared_value as float; the service must convert it to Decimal
    so SQLAlchemy's Numeric(15,2) column receives the right Python type.
    Uses 1000.00 (distinct from the shared _WAYBILL fixture's 500.00) to make
    the assertion unambiguous.
    """
    db = _make_db_mock(scalar_one_or_none=None, fetchall_rows=[])
    org_id = uuid.uuid4()

    # Capture every object passed to db.add so we can find the Consignment row.
    added_objects: list[object] = []
    db.add.side_effect = added_objects.append

    pp_factory = _make_pp_client_patch(waybill=make_waybill("WAY001", declared_value=1000.00))

    with patch("app.orchestration.consignment_service.get_pp_client", pp_factory):
        await fetch_and_sync_consignment(db, "WAY001", org_id)

    consignment_row = next(obj for obj in added_objects if isinstance(obj, Consignment))
    assert consignment_row.declared_value == Decimal("1000.00")
