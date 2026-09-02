"""Integration tests for /api/v1/precincts."""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

from app.main import app
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User
from app.db.models.enums import OrganizationType
from app.db.session import get_db

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_orgs(db_session: AsyncSession):
    operator_org = Organization(
        id=uuid.uuid4(),
        name="Demo Operator",
        org_type=OrganizationType.OPERATOR,
    )
    client_org = Organization(
        name="Demo Client",
        org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([operator_org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(),
        organization_id=operator_org.id,
        email="demo-dispatcher@freightproof.co.za",
        full_name="Demo Dispatcher",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    return {"org": operator_org, "user": user, "client_org": client_org}


@pytest_asyncio.fixture
async def seed_precincts(db_session: AsyncSession, seed_orgs):
    """Two shared precincts owned by a different org than the dispatcher.

    is_shared=True is required for the dispatcher (operator org) to see
    precincts owned by client_org — mirrors how operators see client depots
    they've opted into sharing.
    """
    client_org = seed_orgs["client_org"]
    origin = Precinct(
        name="Cape Town Depot",
        principal_organization_id=client_org.id,
        latitude="33.9249",
        longitude="18.4241",
        is_shared=True,
    )
    destination = Precinct(
        name="Johannesburg Depot",
        principal_organization_id=client_org.id,
        latitude="26.2041",
        longitude="28.0473",
        is_shared=True,
    )
    db_session.add_all([origin, destination])
    await db_session.flush()


def _auth_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="dispatcher", org_id=str(seed["org"].id))
    )


async def test_list_precincts_empty_returns_200(client: AsyncClient, seed_orgs):
    resp = await client.get(
        "/api/v1/precincts",
        headers=_auth_headers(seed_orgs),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_precincts_returns_shared(client: AsyncClient, seed_orgs, seed_precincts):
    resp = await client.get(
        "/api/v1/precincts",
        headers=_auth_headers(seed_orgs),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 2
    names = {p["name"] for p in body}
    assert names == {"Cape Town Depot", "Johannesburg Depot"}


async def test_list_precincts_excludes_other_org_non_shared(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """A precinct owned by another org with is_shared=False must not be visible."""
    client_org = seed_orgs["client_org"]
    private_precinct = Precinct(
        name="Private Client Warehouse",
        principal_organization_id=client_org.id,
        latitude="29.8587",
        longitude="31.0218",
        is_shared=False,
    )
    db_session.add(private_precinct)
    await db_session.flush()

    resp = await client.get(
        "/api/v1/precincts",
        headers=_auth_headers(seed_orgs),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert body == []


async def test_list_precincts_includes_own_org_non_shared(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """A precinct owned by the caller's own org is always visible, shared or not."""
    own_precinct = Precinct(
        name="Demo Operator Yard",
        principal_organization_id=seed_orgs["org"].id,
        latitude="-33.9249",
        longitude="18.4241",
        is_shared=False,
    )
    db_session.add(own_precinct)
    await db_session.flush()

    resp = await client.get(
        "/api/v1/precincts",
        headers=_auth_headers(seed_orgs),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert [p["name"] for p in body] == ["Demo Operator Yard"]


_ANCHOR = "app.orchestration.precinct_service.anchor_subject"


def _admin_headers(seed: dict) -> dict:
    return auth_header(
        make_token(sub=str(seed["user"].id), role="admin_dispatcher", org_id=str(seed["org"].id))
    )


def _valid_body() -> dict:
    return {
        "name": "Riverhorse Valley",
        "address": "12 Sookhai Place, Durban",
        "latitude": -29.7942,
        "longitude": 30.9820,
        "geofence_radius_metres": 200,
    }


async def _fake_anchor(db, *, subject_type, subject_id, canonical_payload, receipt_type, **_):
    """Stand-in for anchor_subject that skips Hedera but still persists a receipt row.

    anchor_subject's real body inserts the BlockchainReceipt (db.add + flush) before
    returning it, and precinct_events.blockchain_receipt_id is a real FK against
    blockchain_receipts.id — a mock that hands back a transient, unpersisted receipt
    fails on the service's next flush with an IntegrityError, not a useful assertion.
    subject_id is taken from the real call (the event id being anchored), not
    fabricated, so a detail-view test querying receipts by event id still finds them.
    """
    from app.db.models.blockchain import BlockchainReceipt

    receipt = BlockchainReceipt(
        id=uuid.uuid4(),
        subject_type=subject_type,
        subject_id=subject_id,
        receipt_type=receipt_type,
        data_hash="0" * 64,
        payload_json=canonical_payload,
    )
    db.add(receipt)
    await db.flush()
    return receipt


def _stub_anchor():
    """Patch the anchor so no integration test reaches Hedera."""
    return patch(_ANCHOR, new=AsyncMock(side_effect=_fake_anchor))


async def test_create_precinct_returns_201_and_appears_in_list(client: AsyncClient, seed_orgs):
    """The demo path end to end: map a facility, then find it available for a trip."""
    with _stub_anchor():
        create_resp = await client.post(
            "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
        )

    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "Riverhorse Valley"
    assert created["geofence_radius_metres"] == 200
    assert created["principal_organization_id"] == str(seed_orgs["org"].id)

    list_resp = await client.get("/api/v1/precincts", headers=_auth_headers(seed_orgs))
    assert [p["id"] for p in list_resp.json()] == [created["id"]]


async def test_create_precinct_ignores_a_client_supplied_organization_id(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """SEC-PRECINCT-1. A dispatcher must not create under another org's id."""
    body = {**_valid_body(), "principal_organization_id": str(seed_orgs["client_org"].id)}

    with _stub_anchor():
        resp = await client.post(
            "/api/v1/precincts", json=body, headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 201
    assert resp.json()["principal_organization_id"] == str(seed_orgs["org"].id)

    row = (
        await db_session.execute(
            select(Precinct).where(Precinct.id == uuid.UUID(resp.json()["id"]))
        )
    ).scalar_one()
    assert row.principal_organization_id == seed_orgs["org"].id


async def test_create_precinct_as_non_admin_returns_403(client: AsyncClient, seed_orgs):
    resp = await client.post(
        "/api/v1/precincts", json=_valid_body(), headers=_auth_headers(seed_orgs),
    )

    assert resp.status_code == 403


async def test_create_precinct_without_a_token_returns_403(client: AsyncClient, seed_orgs):
    resp = await client.post("/api/v1/precincts", json=_valid_body())

    assert resp.status_code == 403


@pytest.mark.parametrize(
    "field,value",
    [
        ("latitude", 91.0), ("latitude", -91.0),
        ("longitude", 181.0), ("longitude", -181.0),
        ("geofence_radius_metres", 0),
        ("geofence_radius_metres", 49),
        ("geofence_radius_metres", 5001),
        ("name", "   "),
    ],
)
async def test_create_precinct_rejects_invalid_field_with_422(
    client: AsyncClient, seed_orgs, field, value
):
    resp = await client.post(
        "/api/v1/precincts",
        json={**_valid_body(), field: value},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 422


async def test_create_precinct_duplicate_name_in_same_org_returns_409(
    client: AsyncClient, seed_orgs
):
    with _stub_anchor():
        await client.post(
            "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
        )
        resp = await client.post(
            "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 409


async def test_update_precinct_changes_radius_and_returns_200(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()

        resp = await client.patch(
            f"/api/v1/precincts/{created['id']}",
            json={"geofence_radius_metres": 350},
            headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 200
    assert resp.json()["geofence_radius_metres"] == 350
    assert resp.json()["name"] == "Riverhorse Valley"

    row = (
        await db_session.execute(
            select(Precinct).where(Precinct.id == uuid.UUID(created["id"]))
        )
    ).scalar_one()
    assert row.geofence_radius_metres == 350


async def test_update_precinct_owned_by_another_org_returns_404(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """404, not 403 — matching the existing query scoping."""
    theirs = Precinct(
        name="Private Client Warehouse",
        principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=False,
    )
    db_session.add(theirs)
    await db_session.flush()

    resp = await client.patch(
        f"/api/v1/precincts/{theirs.id}",
        json={"geofence_radius_metres": 350},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


async def test_update_a_visible_shared_precinct_still_returns_404(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """Visibility is not permission: listed by GET, and still unwritable."""
    theirs = Precinct(
        name="Shared Client Depot",
        principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=True,
    )
    db_session.add(theirs)
    await db_session.flush()

    listed = await client.get("/api/v1/precincts", headers=_auth_headers(seed_orgs))
    assert [p["id"] for p in listed.json()] == [str(theirs.id)]

    resp = await client.patch(
        f"/api/v1/precincts/{theirs.id}",
        json={"geofence_radius_metres": 350},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


async def test_update_precinct_as_non_admin_returns_403(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    mine = Precinct(
        name="Own Depot", principal_organization_id=seed_orgs["org"].id,
        latitude="-29.8587", longitude="31.0218",
    )
    db_session.add(mine)
    await db_session.flush()

    resp = await client.patch(
        f"/api/v1/precincts/{mine.id}",
        json={"geofence_radius_metres": 350},
        headers=_auth_headers(seed_orgs),
    )

    assert resp.status_code == 403


async def test_update_precinct_unknown_id_returns_404(client: AsyncClient, seed_orgs):
    resp = await client.patch(
        f"/api/v1/precincts/{uuid.uuid4()}",
        json={"geofence_radius_metres": 350},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


async def test_detail_returns_the_change_history_with_receipts_for_the_owning_admin(
    client: AsyncClient, seed_orgs
):
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()
        await client.patch(
            f"/api/v1/precincts/{created['id']}",
            json={"geofence_radius_metres": 350},
            headers=_admin_headers(seed_orgs),
        )

    resp = await client.get(
        f"/api/v1/precincts/{created['id']}", headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert [e["event_type"] for e in body["events"]] == ["geofence_resized", "created"]
    assert len(body["receipts"]) == 2


async def test_detail_withholds_receipts_from_a_non_admin(client: AsyncClient, seed_orgs):
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()

    resp = await client.get(
        f"/api/v1/precincts/{created['id']}", headers=_auth_headers(seed_orgs),
    )

    assert resp.status_code == 200
    assert resp.json()["receipts"] == []
    assert len(resp.json()["events"]) == 1


async def test_detail_of_a_precinct_in_another_org_returns_404(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    theirs = Precinct(
        name="Private", principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=False,
    )
    db_session.add(theirs)
    await db_session.flush()

    resp = await client.get(
        f"/api/v1/precincts/{theirs.id}", headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 404


@pytest.mark.parametrize(
    "field", ["name", "latitude", "longitude", "geofence_radius_metres", "is_shared"]
)
async def test_update_precinct_rejects_an_explicit_null_with_422(
    client: AsyncClient, seed_orgs, field: str
):
    """A null on a NOT NULL column is a client error, not a server error.

    Before PrecinctUpdateBody distinguished omissible from nullable, this body passed
    validation, reached setattr(precinct, field, None) and raised NotNullViolation at
    flush — surfacing as a 500 on a well-formed request no handler could interpret.
    """
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()

    resp = await client.patch(
        f"/api/v1/precincts/{created['id']}",
        json={field: None},
        headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 422
    # The error must name the offending field so the dispatcher UI can point at it.
    assert field in str(resp.json()["detail"])


async def test_update_precinct_can_still_clear_the_address(client: AsyncClient, seed_orgs):
    """address is the one nullable column, and an explicit null must still clear it."""
    with _stub_anchor():
        created = (
            await client.post(
                "/api/v1/precincts", json=_valid_body(), headers=_admin_headers(seed_orgs),
            )
        ).json()
        assert created["address"] is not None

        resp = await client.patch(
            f"/api/v1/precincts/{created['id']}",
            json={"address": None},
            headers=_admin_headers(seed_orgs),
        )

    assert resp.status_code == 200
    assert resp.json()["address"] is None


async def test_create_precinct_rejects_an_over_length_address(client: AsyncClient, seed_orgs):
    """address lands in an unbounded Text column with no body-size middleware in front."""
    body = _valid_body() | {"address": "x" * 501}

    resp = await client.post(
        "/api/v1/precincts", json=body, headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 422


async def test_detail_of_a_shared_precinct_withholds_the_change_history(
    client: AsyncClient, db_session: AsyncSession, seed_orgs
):
    """is_shared publishes WHERE a facility is, never how it got there.

    The events carry every historical coordinate the depot has had and the user ids of
    the admins who moved it — another organisation's internal record. subject_visibility
    already refuses to verify these receipts for a non-owner; this is the same rule
    applied to the read path.

    This is the case that distinguishes "can see the precinct" from "owns the precinct",
    and no test previously exercised it: an admin caller made the role check pass, and
    every other detail test was either the owner or a 404.
    """
    theirs = Precinct(
        name="Their Shared Depot",
        principal_organization_id=seed_orgs["client_org"].id,
        latitude="-29.8587", longitude="31.0218", is_shared=True,
    )
    db_session.add(theirs)
    await db_session.flush()

    from app.db.models.events import PrecinctEvent
    from app.db.models.enums import PrecinctEventType

    db_session.add(
        PrecinctEvent(
            id=uuid.uuid4(),
            precinct_id=theirs.id,
            event_type=PrecinctEventType.RELOCATED.value,
            changed_fields={"latitude": {"from": -29.1, "to": -29.8587}},
            changed_by_user_id=seed_orgs["user"].id,
        )
    )
    await db_session.flush()

    resp = await client.get(
        f"/api/v1/precincts/{theirs.id}", headers=_admin_headers(seed_orgs),
    )

    assert resp.status_code == 200
    body = resp.json()
    # Visible: the current geofence, which is the whole point of sharing.
    assert body["name"] == "Their Shared Depot"
    assert body["geofence_radius_metres"] is not None
    # Withheld: how it got there, and who moved it.
    assert body["events"] == []
    assert body["receipts"] == []
