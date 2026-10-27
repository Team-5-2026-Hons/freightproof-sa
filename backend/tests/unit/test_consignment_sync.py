"""Unit tests for orchestration/consignments/sync.py.

All tests are DB-free — the AsyncSession and get_pp_client are fully mocked.
No real network calls, no migrations, no fixtures requiring a live DB.

Test structure mirrors the pattern in test_supabase_admin.py: patch at the
module path seen by the SUT, use AsyncMock for coroutines.
"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import ConsignmentAlreadyAssignedError
from app.db.models.enums import ParcelStatus, TripStatus
from app.db.models.trips import Consignment, Parcel
from app.integrations.parcel_perfect import (
    MOCK_WAYBILLS,
    PPContents,
    PPTrack,
    PPWaybillDetails,
    PPWaybillResponse,
)
from app.orchestration.consignments.sync import (
    fetch_and_sync_consignment,
    get_assigned_trip_reference,
)

_NO_ORG_CALL = object()

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
    org_lookup_result: object = _NO_ORG_CALL,
) -> MagicMock:
    """Build a minimal AsyncSession mock.

    scalar_one_or_none: returned by the Consignment lookup db.execute() call
        (always the first query).
    org_lookup_result: returned by the Organization lookup db.execute() call,
        which runs after the consignment lookup. Only queried when the
        consignment has no resolved client org AND the waybill's accnum is
        truthy — the local dummy fixtures in this file default accnum to ""
        so that call never fires; pass the resolved org id (or None, for
        "not found") when driving a MOCK_WAYBILLS entry with a real accnum.
    fetchall_rows:      returned by the existing-barcode db.execute() call (last).
    """
    if fetchall_rows is None:
        fetchall_rows = []

    consignment_result = MagicMock()
    consignment_result.scalar_one_or_none.return_value = scalar_one_or_none

    barcode_result = MagicMock()
    barcode_result.fetchall.return_value = fetchall_rows

    results: list[MagicMock] = [consignment_result]
    if org_lookup_result is not _NO_ORG_CALL:
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = org_lookup_result
        results.append(org_result)
    results.append(barcode_result)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=results)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _make_pp_client_patch(waybill: PPWaybillResponse = _WAYBILL) -> MagicMock:
    """Patch get_pp_client so its returned client.get_single_waybill returns waybill."""
    client = MagicMock()
    client.get_single_waybill = AsyncMock(return_value=waybill)
    factory = MagicMock(return_value=client)
    return factory



@pytest.mark.asyncio
async def test_new_consignment_is_inserted():
    """First call for a pp_reference inserts a new Consignment row."""
    db = _make_db_mock(scalar_one_or_none=None, fetchall_rows=[])
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            trip_id=_TRIP_ID,
        )

    assert db.add.called, "db.add must be called for a new consignment"

    added_obj = db.add.call_args_list[0][0][0]
    assert isinstance(added_obj, Consignment)
    assert added_obj.parcel_perfect_reference == _PP_REF
    assert added_obj.parcel_count_expected == 2
    assert added_obj.trip_id == _TRIP_ID
    assert added_obj.client_organization_id is None

    db.flush.assert_awaited_once()

    assert result.consignment is added_obj
    assert result.warning is not None, "unmapped/blank accnum must surface a warning"


@pytest.mark.asyncio
async def test_existing_consignment_is_updated_not_duplicated():
    """Second call with same pp_reference refreshes fields but inserts no duplicate Consignment."""
    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = _TRIP_ID
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0

    fetchall_rows = [("WAY0010001",), ("WAY0010002",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
        )

    assert not db.add.called, "db.add must NOT be called when all rows already exist"

    assert existing.parcel_count_expected == 2
    assert existing.pp_raw_json != {}, "pp_raw_json must be updated"

    assert result.consignment is existing


@pytest.mark.asyncio
async def test_new_parcels_inserted_for_existing_consignment():
    """PP returns 2 tracks but only 1 barcode exists — exactly 1 new Parcel is inserted."""
    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = None
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0

    fetchall_rows = [("WAY0010001",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
        )

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
    existing.trip_id = None
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0

    fetchall_rows = [("WAY0010001",), ("WAY0010002",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            trip_id=new_trip_id,
        )

    assert existing.trip_id == new_trip_id


@pytest.mark.asyncio
async def test_pp_error_propagates():
    """PP raising ValueError must propagate — no DB writes should occur."""
    db = _make_db_mock()

    client = MagicMock()
    client.get_single_waybill = AsyncMock(side_effect=ValueError("PP error"))
    pp_factory = MagicMock(return_value=client)

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        with pytest.raises(ValueError, match="PP error"):
            await fetch_and_sync_consignment(
                db=db,
                pp_reference=_PP_REF,
            )

    assert not db.add.called, "db.add must not be called when PP raises"
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

    added_objects: list[object] = []
    db.add.side_effect = added_objects.append

    pp_factory = _make_pp_client_patch(waybill=make_waybill("WAY001", declared_value=1000.00))

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        await fetch_and_sync_consignment(db, "WAY001")

    consignment_row = next(obj for obj in added_objects if isinstance(obj, Consignment))
    assert consignment_row.declared_value == Decimal("1000.00")



@pytest.mark.asyncio
async def test_accnum_resolves_client_org():
    """A waybill whose accnum matches an Organization resolves client_organization_id.

    WAY001 in MOCK_WAYBILLS carries accnum="MOCK01". When an Organization row
    exists with that pp_account_number, the new Consignment must be linked to
    it and no warning should be raised.
    """
    org_id = uuid.uuid4()
    db = _make_db_mock(scalar_one_or_none=None, fetchall_rows=[], org_lookup_result=org_id)
    pp_factory = _make_pp_client_patch(waybill=MOCK_WAYBILLS["WAY001"])

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(db=db, pp_reference="WAY001")

    added_obj = db.add.call_args_list[0][0][0]
    assert isinstance(added_obj, Consignment)
    assert added_obj.client_organization_id == org_id
    assert result.consignment is added_obj
    assert result.warning is None


@pytest.mark.asyncio
async def test_unmapped_accnum_warns_and_saves_null_client():
    """A waybill whose accnum has no matching Organization saves with a null client
    and a warning mentioning the unmapped account.

    WAY004 in MOCK_WAYBILLS carries accnum="UNMAP9", deliberately unmapped.
    """
    db = _make_db_mock(scalar_one_or_none=None, fetchall_rows=[], org_lookup_result=None)
    pp_factory = _make_pp_client_patch(waybill=MOCK_WAYBILLS["WAY004"])

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(db=db, pp_reference="WAY004")

    added_obj = db.add.call_args_list[0][0][0]
    assert isinstance(added_obj, Consignment)
    assert added_obj.client_organization_id is None
    assert result.warning is not None
    assert "UNMAP9" in result.warning


@pytest.mark.asyncio
async def test_unit_count_and_manifest_persisted():
    """unit_count_expected and pp_manifest_number are persisted on a new consignment.

    WAY001 carries manifest=69 in MOCK_WAYBILLS; unit_count_expected is
    dispatcher-entered and passed straight through.
    """
    org_id = uuid.uuid4()
    db = _make_db_mock(scalar_one_or_none=None, fetchall_rows=[], org_lookup_result=org_id)
    pp_factory = _make_pp_client_patch(waybill=MOCK_WAYBILLS["WAY001"])

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(
            db=db,
            pp_reference="WAY001",
            unit_count_expected=4,
        )

    assert result.consignment.unit_count_expected == 4
    assert result.consignment.pp_manifest_number == 69


@pytest.mark.asyncio
async def test_refresh_does_not_blank_unit_count():
    """A refresh sync without unit_count_expected must not blank a previously set count.

    The Celery poll never passes unit_count_expected — this is the dispatcher-entered
    consolidated unit count and must survive automatic refresh cycles untouched.
    """
    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = _TRIP_ID
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0
    existing.unit_count_expected = 4
    existing.client_organization_id = uuid.uuid4()

    fetchall_rows = [("WAY0010001",), ("WAY0010002",), ("WAY0010003",), ("WAY0010004",), ("WAY0010005",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch(waybill=MOCK_WAYBILLS["WAY001"])

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(db=db, pp_reference="WAY001")

    assert result.consignment.unit_count_expected == 4
    assert db.execute.await_count == 2, (
        f"expected 2 db.execute calls (consignment + barcodes), got {db.execute.await_count}"
    )
    assert result.warning is None



@pytest.mark.asyncio
async def test_reuse_on_a_different_trip_is_rejected():
    """A waybill already linked to trip A must not be reassignable to trip B."""
    owning_trip_id = uuid.uuid4()
    requesting_trip_id = uuid.uuid4()

    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = owning_trip_id

    consignment_result = MagicMock()
    consignment_result.scalar_one_or_none.return_value = existing
    owner_result = MagicMock()
    owner_result.one_or_none.return_value = SimpleNamespace(
        trip_reference="FP-20260101-OWNER01", status=TripStatus.ACTIVE,
    )

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[consignment_result, owner_result])
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.rollback = AsyncMock()

    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        with pytest.raises(ConsignmentAlreadyAssignedError) as exc_info:
            await fetch_and_sync_consignment(
                db=db,
                pp_reference=_PP_REF,
                trip_id=requesting_trip_id,
            )

    assert exc_info.value.pp_reference == _PP_REF
    assert exc_info.value.trip_reference == "FP-20260101-OWNER01"
    assert "FP-20260101-OWNER01" in str(exc_info.value)
    assert not db.add.called, "db.add must not be called when reuse is rejected"
    assert not db.flush.called, "db.flush must not be called when reuse is rejected"


@pytest.mark.asyncio
async def test_resync_on_the_same_trip_is_allowed():
    """The Celery refresh poll re-syncs a consignment onto the trip it already has."""
    trip_id = uuid.uuid4()

    existing = MagicMock(spec=Consignment)
    existing.id = uuid.uuid4()
    existing.trip_id = trip_id
    existing.pp_raw_json = {}
    existing.parcel_count_expected = 0
    existing.client_organization_id = uuid.uuid4()

    fetchall_rows = [("WAY0010001",), ("WAY0010002",)]
    db = _make_db_mock(scalar_one_or_none=existing, fetchall_rows=fetchall_rows)
    pp_factory = _make_pp_client_patch()

    with patch("app.orchestration.consignments.sync.get_pp_client", pp_factory):
        result = await fetch_and_sync_consignment(
            db=db,
            pp_reference=_PP_REF,
            trip_id=trip_id,
        )

    assert result.consignment is existing
    assert existing.trip_id == trip_id


@pytest.mark.asyncio
async def test_get_assigned_trip_reference_returns_reference_when_assigned():
    """A pp_reference already linked to a trip returns that trip's reference."""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = "FP-TEST-PP"
    db.execute = AsyncMock(return_value=result)

    trip_reference = await get_assigned_trip_reference(db, "WAY001")

    assert trip_reference == "FP-TEST-PP"


@pytest.mark.asyncio
async def test_get_assigned_trip_reference_returns_none_when_unassigned():
    """No Consignment row (or one with no trip_id) for this reference returns None."""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(return_value=result)

    trip_reference = await get_assigned_trip_reference(db, "WAY999")

    assert trip_reference is None
