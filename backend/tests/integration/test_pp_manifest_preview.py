"""Manifest preview (FP-281, spec §10.1): read-only, every warning code."""

from httpx import AsyncClient
from collections.abc import AsyncIterator
from tests.conftest import FakeMockStateStore
from pytest import MonkeyPatch
from app.integrations.parcel_perfect import PPManifestResponse

import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import ParcelStatus, TripStatus
from app.db.models.trips import Consignment, Parcel, Trip
from app.db.session import get_db
from app.integrations.parcel_perfect import (
    MANIFEST_HAPPY_PATH, MANIFEST_NO_WAYBILLS, MANIFEST_OPEN_NO_TIMES,
)
from app.main import app
from tests.conftest import auth_header
from tests.integration._pp_manifest_world import (
    create_body, MOCK_CLIENT_NAME, build_manifest_world, insert_trip, install_pp_mock, preview,
)


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


def _codes(body: dict) -> dict[str, bool]:
    return {w["code"]: w["blocking"] for w in body["warnings"]}


async def _hold(db_session: AsyncSession, trip: Trip, waybill: str, *, scanned: bool = False) -> None:
    consignment = Consignment(id=uuid.uuid4(), trip_id=trip.id, parcel_perfect_reference=waybill)
    db_session.add(consignment)
    await db_session.flush()
    if scanned:
        db_session.add(Parcel(
            id=uuid.uuid4(), consignment_id=consignment.id, barcode=f"{waybill}0001",
            status=ParcelStatus.SCANNED_OUT, pp_scan_out_at=datetime.now(UTC),
        ))
        await db_session.flush()


async def test_preview_of_a_clean_manifest(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert body["can_create"] is True
    assert body["warnings"] == []
    assert body["pp_manifest"]["display"] == f"{MOCK_CLIENT_NAME} · CPT {MANIFEST_HAPPY_PATH}"
    assert body["client_organization_id"] == str(world.client.id)
    assert body["origin"] == {"hub_code": "CPT", "precinct_id": str(world.cape_town.id), "precinct_name": world.cape_town.name}
    assert body["destination"]["precinct_id"] == str(world.johannesburg.id)
    assert body["totals"] == {"waybills": 3, "parcels": 20, "weight_kg": 875.5}
    assert [line["waybill"] for line in body["waybills"]] == ["MFTWB8101", "MFTWB8102", "MFTWB8103"]
    assert body["is_closed"] is True
    assert body["client_reference"] == "PO-CGY-0081"
    assert body["planned_departure_at"] is not None
    assert len(body["snapshot_sha256"]) == 64


async def test_preview_writes_nothing(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    await preview(client, world, MANIFEST_HAPPY_PATH)

    assert (await db_session.execute(select(func.count(Trip.id)))).scalar_one() == 0
    assert (await db_session.execute(select(func.count(Consignment.id)))).scalar_one() == 0


async def test_preview_requires_a_valid_token(client: AsyncClient, db_session: AsyncSession) -> None:
    resp = await client.get(
        "/api/v1/trips/pp-manifest-preview", params={"manifest_number": MANIFEST_HAPPY_PATH},
        headers=auth_header("not-a-jwt"),
    )

    assert resp.status_code == 401


async def test_unknown_manifest_is_404(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    resp = await client.get(
        "/api/v1/trips/pp-manifest-preview", params={"manifest_number": 99999}, headers=world.headers(),
    )

    assert resp.status_code == 404


async def test_live_pp_is_501(client: AsyncClient, db_session: AsyncSession, monkeypatch: MonkeyPatch) -> None:
    world = await build_manifest_world(db_session)
    monkeypatch.setattr(settings, "PP_USE_MOCK", False)

    resp = await client.get(
        "/api/v1/trips/pp-manifest-preview", params={"manifest_number": MANIFEST_HAPPY_PATH},
        headers=world.headers(),
    )

    assert resp.status_code == 501
    assert resp.json()["detail"] == "Manifest lookup is not available on the live Parcel Perfect API."


async def test_pp_outage_is_502(client: AsyncClient, db_session: AsyncSession, monkeypatch: MonkeyPatch) -> None:
    world = await build_manifest_world(db_session)

    class _DownPP:
        async def get_manifest(self, manifest_number: int) -> PPManifestResponse:
            raise httpx.ConnectError("PP down")

    monkeypatch.setattr("app.orchestration.pp_manifest_service.get_pp_client", lambda: _DownPP())

    resp = await client.get(
        "/api/v1/trips/pp-manifest-preview", params={"manifest_number": MANIFEST_HAPPY_PATH},
        headers=world.headers(),
    )

    assert resp.status_code == 502


async def test_manifest_already_on_a_trip_blocks(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    holder = await insert_trip(db_session, world, number=MANIFEST_HAPPY_PATH)

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    warning = next(w for w in body["warnings"] if w["code"] == "MANIFEST_ALREADY_ON_TRIP")
    assert warning["blocking"] is True
    assert warning["trip_reference"] == holder.trip_reference
    assert body["can_create"] is False


async def test_a_cancelled_trip_does_not_hold_its_manifest(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=MANIFEST_HAPPY_PATH, status=TripStatus.CANCELLED)

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert "MANIFEST_ALREADY_ON_TRIP" not in _codes(body)


async def test_unlinked_client_blocks(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session, client_account="OTHER1")

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert _codes(body)["CLIENT_NOT_LINKED"] is True
    assert body["client_organization_id"] is None
    assert body["client_name"] == MOCK_CLIENT_NAME  # the issuer name from PP


async def test_mixed_client_manifest_blocks(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    body = await preview(client, world, 70)

    warning = next(w for w in body["warnings"] if w["code"] == "WAYBILL_CLIENT_MISMATCH")
    assert warning["blocking"] is True
    assert warning["waybills"] == ["WAY004"]


async def test_waybill_on_another_live_trip_blocks(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    other = await insert_trip(db_session, world, number=None)
    await _hold(db_session, other, "MFTWB8102")

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    warning = next(w for w in body["warnings"] if w["code"] == "WAYBILL_ON_OTHER_TRIP")
    assert (warning["blocking"], warning["trip_reference"], warning["waybills"]) == (
        True, other.trip_reference, ["MFTWB8102"],
    )


async def test_waybill_on_a_cancelled_unscanned_trip_is_movable(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    cancelled = await insert_trip(db_session, world, number=None, status=TripStatus.CANCELLED)
    await _hold(db_session, cancelled, "MFTWB8102")

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert "WAYBILL_ON_OTHER_TRIP" not in _codes(body)


async def test_waybill_scanned_on_a_cancelled_trip_blocks(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    cancelled = await insert_trip(db_session, world, number=None, status=TripStatus.CANCELLED)
    await _hold(db_session, cancelled, "MFTWB8102", scanned=True)

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert _codes(body)["WAYBILL_ON_OTHER_TRIP"] is True


async def test_empty_manifest_blocks(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    body = await preview(client, world, MANIFEST_NO_WAYBILLS)

    assert _codes(body)["NO_WAYBILLS"] is True


async def test_unlinked_origin_prompts_without_blocking(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session, linked_hubs=("JNB",))

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert _codes(body) == {"ORIGIN_HUB_UNLINKED": False}
    assert body["origin"]["precinct_id"] is None
    assert body["can_create"] is True


async def test_unlinked_destination_prompts_without_blocking(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    body = await preview(client, world, 69)  # JNB → DUR; DUR has no precinct

    assert _codes(body) == {"DESTINATION_HUB_UNLINKED": False}


async def test_private_client_precincts_are_never_shown(client: AsyncClient, db_session: AsyncSession) -> None:
    """SEC-PRECINCT-1: a depot the dispatcher cannot see is an unlinked hub, not a name."""
    world = await build_manifest_world(db_session, shared=False)

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    assert _codes(body) == {"ORIGIN_HUB_UNLINKED": False, "DESTINATION_HUB_UNLINKED": False}
    assert body["origin"]["precinct_id"] is None
    assert body["destination"]["precinct_id"] is None
    serialised = json.dumps(body)
    assert world.cape_town.name not in serialised
    assert world.johannesburg.name not in serialised


async def test_open_manifest_without_times_informs(client: AsyncClient, db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)

    body = await preview(client, world, MANIFEST_OPEN_NO_TIMES)

    assert _codes(body) == {"NO_PLANNED_TIMES": False, "MANIFEST_NOT_CLOSED": False}
    assert body["is_closed"] is False


@pytest.mark.parametrize("scanned", [False, True])
@pytest.mark.parametrize("surface", ["preview", "create"])
async def test_foreign_waybill_conflict_keeps_trip_identity_private(
    client: AsyncClient, db_session: AsyncSession, scanned: bool, surface: str,
) -> None:
    world = await build_manifest_world(db_session)
    foreign = await build_manifest_world(db_session, client_account="OTHER1")
    holder = await insert_trip(
        db_session, foreign, number=None,
        status=TripStatus.CANCELLED if scanned else TripStatus.ACTIVE,
    )
    await _hold(db_session, holder, "MFTWB8102", scanned=scanned)
    private_id, private_reference = str(holder.id), holder.trip_reference

    body = await preview(client, world, MANIFEST_HAPPY_PATH)

    if surface == "preview":
        warning = next(w for w in body["warnings"] if w["code"] == "WAYBILL_ON_OTHER_TRIP")
        assert warning["blocking"] is True
        assert warning["waybills"] == ["MFTWB8102"]
        assert warning["trip_id"] is None and warning["trip_reference"] is None
        assert private_id not in json.dumps(body) and private_reference not in json.dumps(body)
    else:
        response = await client.post(
            "/api/v1/trips/from-pp-manifest", json=create_body(world, body), headers=world.headers(),
        )
        assert response.status_code == 409, response.text
        assert private_id not in response.text and private_reference not in response.text
