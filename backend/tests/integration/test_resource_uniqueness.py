"""Uniqueness of fleet and driver identifiers within an organisation.

Both services already catch a unique violation and turn it into a 409 — but until
now the constraints they were catching did not exist for the fields they name. The
result was not a race: two vehicles with the same registration, or two drivers with
the same SA ID number, were simply accepted, sequentially and silently. And the one
constraint that DID exist on vehicles (organization_id, pulsit_device_id) was being
reported as a duplicate *registration*, sending a dispatcher to correct a field that
was never wrong.

Scope is per organisation, matching the existing uq_vehicles_org_pulsit. A plate and
an ID number are nationally unique in the real world, but FreightProof does not yet
model a vehicle or a driver moving between operators, and an org-scoped constraint
leaves room for that without a data migration later.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.db.session import get_db
from app.main import app
from tests.conftest import auth_header, make_token


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def admin(db_session: AsyncSession):
    """An operator org plus an admin dispatcher — fleet and driver creation both
    sit behind require_admin_dispatcher."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"admin-{uuid.uuid4().hex[:8]}@test.co.za", full_name="Admin",
    )
    db_session.add(user)
    await db_session.flush()
    return {
        "org": org,
        "user": user,
        "headers": auth_header(
            make_token(sub=str(user.id), role="admin_dispatcher", org_id=str(org.id))
        ),
    }


def _vehicle(registration: str, pulsit_device_id: str) -> dict:
    return {
        "registration": registration,
        "vehicle_type": "horse",
        "pulsit_device_id": pulsit_device_id,
    }


async def test_duplicate_registration_in_same_org_is_refused(client: AsyncClient, admin):
    """Two vehicles in one fleet cannot share a registration.

    Nothing about this needs concurrency: do it twice, slowly, and both used to be
    accepted. A fleet holding the same plate twice makes every later lookup by
    registration ambiguous, including the ones a dispatcher does by eye.
    """
    first = await client.post(
        "/api/v1/vehicles", json=_vehicle("CA 111-111", "PLT-A"), headers=admin["headers"],
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/vehicles", json=_vehicle("CA 111-111", "PLT-B"), headers=admin["headers"],
    )

    assert second.status_code == 409, second.text
    assert "registration" in second.json()["detail"]


async def test_duplicate_pulsit_device_names_the_device_not_the_registration(
    client: AsyncClient, admin
):
    """The 409 must name the field that actually clashed.

    (organization_id, pulsit_device_id) has been constrained all along, but the
    handler reported every unique violation as a duplicate registration. A
    dispatcher told their registration is taken — when the registration is fine and
    the tracker is double-assigned — goes and edits the one thing that was correct.
    """
    first = await client.post(
        "/api/v1/vehicles", json=_vehicle("CA 222-222", "PLT-SHARED"), headers=admin["headers"],
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/vehicles", json=_vehicle("CA 333-333", "PLT-SHARED"), headers=admin["headers"],
    )

    assert second.status_code == 409, second.text
    detail = second.json()["detail"]
    assert "pulsit_device_id" in detail, f"409 named the wrong field: {detail!r}"


async def test_duplicate_driver_id_number_in_same_org_is_refused(client: AsyncClient, admin):
    """One SA ID number, one driver record per organisation.

    create_driver_auth_user is patched: it makes a real HTTP call to Supabase, and a
    test that provisions live auth accounts pollutes a shared project and depends on
    whatever previous runs left behind.
    """
    def _body(phone: str) -> dict:
        return {
            "full_name": "Test Driver",
            "id_number": "8001015009087",
            "phone_number": phone,
            "license_number": "DRV-001",
        }

    with patch(
        "app.orchestration.driver_service.create_driver_auth_user",
        new_callable=AsyncMock,
    ) as mock_auth:
        mock_auth.side_effect = lambda **kwargs: uuid.uuid4()

        first = await client.post(
            "/api/v1/drivers", json=_body("+27821111111"), headers=admin["headers"],
        )
        assert first.status_code == 201, first.text

        second = await client.post(
            "/api/v1/drivers", json=_body("+27822222222"), headers=admin["headers"],
        )

    assert second.status_code == 409, second.text
    assert "id_number" in second.json()["detail"]


async def test_patching_a_registration_onto_an_existing_one_is_refused(
    client: AsyncClient, admin
):
    """Renaming a vehicle onto another's plate must 409, not 500.

    create_vehicle translates the constraint into a clean 409; update_vehicle flushes
    without catching anything, so the same collision arrived as an unhandled
    IntegrityError. Adding the constraint is what made this path reachable at all —
    before it, the rename simply succeeded and left the fleet holding one plate twice.
    """
    first = await client.post(
        "/api/v1/vehicles", json=_vehicle("CA 444-444", "PLT-P1"), headers=admin["headers"],
    )
    assert first.status_code == 201
    second = await client.post(
        "/api/v1/vehicles", json=_vehicle("CA 555-555", "PLT-P2"), headers=admin["headers"],
    )
    assert second.status_code == 201

    resp = await client.patch(
        f"/api/v1/vehicles/{second.json()['id']}",
        json={"registration": "CA 444-444"},
        headers=admin["headers"],
    )

    assert resp.status_code == 409, resp.text
    assert "registration" in resp.json()["detail"]
