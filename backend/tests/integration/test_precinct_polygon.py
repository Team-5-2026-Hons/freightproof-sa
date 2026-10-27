"""Integration tests for precinct property outlines through /api/v1/precincts:
stored, returned, anchored as a critical change, and kept consistent with the pin."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import OrganizationType
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

_ANCHOR = "app.orchestration.fleet.precincts.anchor_subject"
_BOX = [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]]
_BOX_NORTH = [[round(lat + 0.01, 7), lng] for lat, lng in _BOX]


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def admin(db_session: AsyncSession) -> dict[str, str]:
    org = Organization(id=uuid.uuid4(), name="Outline Operator", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex}@fp.co.za",
        full_name="Admin", is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return auth_header(make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id)))


async def _fake_anchor(db, *, subject_type, subject_id, canonical_payload, receipt_type, **_):
    """Persists a receipt (precinct_events has a real FK to it) without reaching Hedera."""
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
        receipt_type=receipt_type, data_hash="0" * 64, payload_json=canonical_payload,
    )
    db.add(receipt)
    await db.flush()
    return receipt


def _stub_anchor():
    return patch(_ANCHOR, new=AsyncMock(side_effect=_fake_anchor))


def _body(**overrides: object) -> dict[str, object]:
    return {
        "name": f"Outline Depot {uuid.uuid4().hex[:6]}",
        "latitude": -29.7942, "longitude": 30.9820,
        "geofence_radius_metres": 200, "geofence_polygon": _BOX, **overrides,
    }


async def _events(db_session: AsyncSession, precinct_id: str) -> list[PrecinctEvent]:
    return list((await db_session.execute(
        select(PrecinctEvent).where(PrecinctEvent.precinct_id == uuid.UUID(precinct_id))
        .order_by(PrecinctEvent.created_at)
    )).scalars())


async def test_create_with_outline_stores_returns_and_anchors_it(client: AsyncClient, db_session, admin):
    with _stub_anchor() as anchor:
        resp = await client.post("/api/v1/precincts", json=_body(), headers=admin)

    assert resp.status_code == 201
    assert resp.json()["geofence_polygon"] == _BOX
    stored = await db_session.get(Precinct, uuid.UUID(resp.json()["id"]))
    assert stored is not None and stored.geofence_polygon == _BOX
    created_event = (await _events(db_session, resp.json()["id"]))[0]
    assert created_event.changed_fields["geofence_polygon"] == _BOX
    assert anchor.await_count == 1


async def test_create_circle_precinct_has_no_outline_key_in_its_history(client: AsyncClient, db_session, admin):
    with _stub_anchor():
        resp = await client.post("/api/v1/precincts", json=_body(geofence_polygon=None), headers=admin)

    assert resp.json()["geofence_polygon"] is None
    created_event = (await _events(db_session, resp.json()["id"]))[0]
    assert "geofence_polygon" not in created_event.changed_fields


async def test_create_with_pin_far_from_outline_returns_422(client: AsyncClient, admin):
    resp = await client.post("/api/v1/precincts", json=_body(latitude=-29.80, longitude=30.99), headers=admin)

    assert resp.status_code == 422


async def test_create_with_self_crossing_outline_returns_422(client: AsyncClient, admin):
    bowtie = [_BOX[0], _BOX[2], _BOX[1], _BOX[3]]

    resp = await client.post("/api/v1/precincts", json=_body(geofence_polygon=bowtie), headers=admin)

    assert resp.status_code == 422


async def test_reshaping_is_logged_as_geofence_reshaped_and_anchored(client: AsyncClient, db_session, admin):
    with _stub_anchor() as anchor:
        created = (await client.post("/api/v1/precincts", json=_body(), headers=admin)).json()
        resp = await client.patch(
            f"/api/v1/precincts/{created['id']}",
            json={"latitude": -29.7842, "geofence_polygon": _BOX_NORTH},
            headers=admin,
        )

    assert resp.status_code == 200
    assert resp.json()["geofence_polygon"] == _BOX_NORTH
    update_event = (await _events(db_session, created["id"]))[-1]
    assert update_event.event_type == "relocated"
    assert update_event.changed_fields["geofence_polygon"] == {"from": _BOX, "to": _BOX_NORTH}
    assert anchor.await_count == 2


async def test_drawing_an_outline_on_a_circle_precinct_is_a_reshape(client: AsyncClient, db_session, admin):
    with _stub_anchor():
        created = (await client.post("/api/v1/precincts", json=_body(geofence_polygon=None), headers=admin)).json()
        await client.patch(f"/api/v1/precincts/{created['id']}", json={"geofence_polygon": _BOX}, headers=admin)

    update_event = (await _events(db_session, created["id"]))[-1]
    assert update_event.event_type == "geofence_reshaped"
    assert update_event.changed_fields["geofence_polygon"] == {"from": None, "to": _BOX}


async def test_removing_the_outline_returns_to_the_circle(client: AsyncClient, db_session, admin):
    with _stub_anchor():
        created = (await client.post("/api/v1/precincts", json=_body(), headers=admin)).json()
        resp = await client.patch(
            f"/api/v1/precincts/{created['id']}", json={"geofence_polygon": None}, headers=admin,
        )

    assert resp.json()["geofence_polygon"] is None
    update_event = (await _events(db_session, created["id"]))[-1]
    assert update_event.event_type == "geofence_reshaped"


async def test_moving_only_the_pin_away_from_the_outline_returns_422_and_writes_nothing(
    client: AsyncClient, db_session, admin,
):
    with _stub_anchor():
        created = (await client.post("/api/v1/precincts", json=_body(), headers=admin)).json()
        resp = await client.patch(
            f"/api/v1/precincts/{created['id']}", json={"latitude": -29.70}, headers=admin,
        )

    assert resp.status_code == 422
    assert "outside the outline" in resp.json()["detail"]
    stored = await db_session.get(Precinct, uuid.UUID(created["id"]))
    assert stored is not None and float(stored.latitude) == -29.7942
    assert len(await _events(db_session, created["id"])) == 1
