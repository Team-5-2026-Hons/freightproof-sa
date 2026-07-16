"""Integration tests for the dispatcher-facing /pp lookup endpoints.

Mirrors the auth/db harness of test_precincts.py / test_manifest.py. PP_USE_MOCK
is forced True regardless of the local .env so these assertions hold everywhere
the mock fixture library is exercised (WAY001/MOCKWAY001/manifest 69 etc. — see
app/integrations/parcel_perfect.py).
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.core.config import settings
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from app.schemas.pp import PPWaybillSummary

from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def force_pp_mock(monkeypatch):
    """These endpoints are documented as mock-mode assertions — pin PP_USE_MOCK=True
    so the test outcome doesn't depend on the developer's local .env value."""
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)


@pytest_asyncio.fixture
async def seed_dispatcher(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    db_session.add(user)
    await db_session.flush()
    return user, org


async def test_capabilities_returns_manifest_lookup_true(client: AsyncClient, seed_dispatcher):
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/capabilities", headers=auth_header(token))

    assert resp.status_code == 200
    assert resp.json() == {"manifest_lookup": True}


async def test_get_waybill_returns_summary_with_no_extra_keys(client: AsyncClient, seed_dispatcher):
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/waybills/WAY001", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_number"] == "MOCK01"
    # POPIA: the response must be exactly the PPWaybillSummary field set — no
    # receiver-contact fields (e.g. dest_contact) or raw PP payload leakage.
    assert set(body.keys()) == set(PPWaybillSummary.model_fields.keys())


async def test_get_waybill_unknown_reference_returns_404(client: AsyncClient, seed_dispatcher):
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/waybills/NOPE999", headers=auth_header(token))

    assert resp.status_code == 404


async def test_get_manifest_returns_all_waybills_on_manifest(client: AsyncClient, seed_dispatcher):
    user, org = seed_dispatcher
    token = make_token(sub=str(user.id), role="dispatcher", org_id=str(org.id))

    resp = await client.get("/api/v1/pp/manifests/69", headers=auth_header(token))

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 4
    assert {row["waybill"] for row in body} == {"MOCKWAY001", "WAY001", "WAY002", "WAY003"}


async def test_capabilities_no_auth_returns_403(client: AsyncClient, seed_dispatcher):
    resp = await client.get("/api/v1/pp/capabilities")

    assert resp.status_code == 403
