"""A waybill whose parcels an incident names cannot move off its cancelled trip: moving deletes the
parcel rows, and the incident's ledger and affected-cargo list point at them. The refusal must
say which incident, on which trip, so the dispatcher knows why the manifest is unusable."""

import copy
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from pytest import MonkeyPatch
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConsignmentCitedByIncidentError
from app.db.models.enums import (
    IncidentConfidence, IncidentReportChannel, IncidentReporterRole, IncidentType, ParcelStatus, TripStatus,
)
from app.db.models.incidents import IncidentParcel
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.session import get_db
from app.integrations.parcel_perfect import MANIFEST_HAPPY_PATH, MOCK_WAYBILLS
from app.main import app
from app.orchestration.consignments.sync import sync_consignment_from_waybill
from app.orchestration.incidents.creation import report_incident
from app.schemas.incidents import IncidentCreate
from tests.conftest import FakeMockStateStore
from tests.integration._pp_manifest_world import (
    ManifestWorld, build_manifest_world, create_body, insert_trip, install_pp_mock, preview,
)

_WAYBILL = "MFTWB8102"
_TRIP_LENGTH = timedelta(hours=10)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def pp_mock(monkeypatch: MonkeyPatch) -> FakeMockStateStore:
    return install_pp_mock(monkeypatch)


async def _hold(db_session: AsyncSession, trip: Trip) -> Consignment:
    consignment = Consignment(id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=_WAYBILL)
    db_session.add(consignment)
    await db_session.flush()
    db_session.add(Parcel(
        id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"{_WAYBILL}0001", status=ParcelStatus.PENDING,
    ))
    await db_session.flush()
    return consignment


async def _report(db_session: AsyncSession, world: ManifestWorld, trip: Trip, *, all_parcels: bool, stop_trip: bool) -> None:
    await report_incident(
        db_session, trip_id=trip.id, organization_id=world.operator.id, user_id=world.user.id,
        request=IncidentCreate(
            incident_type=IncidentType.HIJACKING, summary="Truck taken at the N1 off-ramp",
            reporter_role=IncidentReporterRole.DRIVER, report_channel=IncidentReportChannel.PHONE,
            confidence=IncidentConfidence.REPORTED, all_parcels=all_parcels, stop_trip=stop_trip,
        ),
    )


async def _hijacked_trip(db_session: AsyncSession, world: ManifestWorld) -> tuple[Trip, Consignment]:
    """The default hijacking report: every parcel named, trip stopped (cancelled)."""
    trip = await insert_trip(db_session, world, number=None, status=TripStatus.ACTIVE)
    consignment = await _hold(db_session, trip)
    await _report(db_session, world, trip, all_parcels=True, stop_trip=True)
    return trip, consignment


async def test_waybill_cited_by_an_incident_is_refused_by_name(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    hijacked, consignment = await _hijacked_trip(db_session, world)
    replacement = await insert_trip(db_session, world, number=None)

    with pytest.raises(ConsignmentCitedByIncidentError) as exc:
        await sync_consignment_from_waybill(
            db_session, copy.deepcopy(MOCK_WAYBILLS[_WAYBILL]), trip_id=replacement.id,
        )

    assert exc.value.incident_references == ("INC1",)
    for expected in (_WAYBILL, "INC1", hijacked.trip_reference, "cannot be used on a new trip"):
        assert expected in str(exc.value)
    assert await db_session.scalar(
        select(func.count()).select_from(Parcel).where(Parcel.consignment_id == consignment.id)
    ) == 1
    assert await db_session.scalar(select(func.count()).select_from(IncidentParcel)) == 1
    await db_session.refresh(consignment)
    assert consignment.trip_id == hijacked.id


async def test_waybill_on_a_cancelled_trip_with_an_incident_naming_no_parcel_still_moves(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip = await insert_trip(db_session, world, number=None, status=TripStatus.ACTIVE)
    consignment = await _hold(db_session, trip)
    await _report(db_session, world, trip, all_parcels=False, stop_trip=True)
    replacement = await insert_trip(db_session, world, number=None)

    result = await sync_consignment_from_waybill(
        db_session, copy.deepcopy(MOCK_WAYBILLS[_WAYBILL]), trip_id=replacement.id,
    )

    assert result.consignment.id == consignment.id
    assert result.consignment.trip_id == replacement.id


async def test_preview_blocks_and_names_the_incident(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    hijacked, _ = await _hijacked_trip(db_session, world)

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    warning = next(w for w in body["warnings"] if w["code"] == "WAYBILL_ON_OTHER_TRIP")
    assert warning["blocking"] is True
    assert warning["trip_reference"] == hijacked.trip_reference
    assert f"{_WAYBILL} cannot move: it is cited by incident INC1." in warning["message"]
    assert body["can_create"] is False


async def test_create_returns_409_that_names_the_incident(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    hijacked, _ = await _hijacked_trip(db_session, world)
    hijacked_reference = hijacked.trip_reference
    previewed = await preview(client, world, MANIFEST_HAPPY_PATH)

    response = await client.post(
        "/api/v1/trips/from-pp-manifest", json=create_body(world, previewed), headers=world.headers(),
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    for expected in (_WAYBILL, "INC1", hijacked_reference):
        assert expected in detail


async def test_another_operators_incident_stays_private(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    foreign = await build_manifest_world(db_session, client_account="OTHER1")
    holder, _ = await _hijacked_trip(db_session, foreign)
    private = (holder.trip_reference, str(holder.id))

    body = await preview(client, world, MANIFEST_HAPPY_PATH)
    response = await client.post(
        "/api/v1/trips/from-pp-manifest", json=create_body(world, body), headers=world.headers(),
    )

    warning = next(w for w in body["warnings"] if w["code"] == "WAYBILL_ON_OTHER_TRIP")
    assert warning["blocking"] is True
    assert response.status_code == 409, response.text
    for text in (str(warning), response.text):
        assert "INC1" not in text and not any(identity in text for identity in private)


def _waybill_list_body(world: ManifestWorld) -> dict:
    """A POST /trips body that names the waybill directly instead of importing a manifest."""
    departure = datetime.now(UTC)
    return {
        "driver_id": str(world.driver.id),
        "horse_id": str(world.horse.id),
        "trailer_ids": [str(world.trailer.id)],
        "origin_precinct_id": str(world.cape_town.id),
        "destination_precinct_id": str(world.johannesburg.id),
        "planned_departure_at": departure.isoformat(),
        "planned_arrival_at": (departure + _TRIP_LENGTH).isoformat(),
        "consignments": [{"pp_reference": _WAYBILL, "unit_count_expected": 1}],
    }


async def test_waybill_list_create_names_own_incident(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    hijacked, _ = await _hijacked_trip(db_session, world)
    hijacked_reference = hijacked.trip_reference

    response = await client.post("/api/v1/trips", json=_waybill_list_body(world), headers=world.headers())

    assert response.status_code == 409, response.text
    for expected in (_WAYBILL, "INC1", hijacked_reference):
        assert expected in response.json()["detail"]


async def test_waybill_list_create_keeps_another_operators_incident_private(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    world = await build_manifest_world(db_session)
    foreign = await build_manifest_world(db_session, client_account="OTHER1")
    holder, _ = await _hijacked_trip(db_session, foreign)
    private = (holder.trip_reference, str(holder.id))

    response = await client.post("/api/v1/trips", json=_waybill_list_body(world), headers=world.headers())

    assert response.status_code == 409, response.text
    assert _WAYBILL in response.text
    assert "INC1" not in response.text and not any(identity in response.text for identity in private)
