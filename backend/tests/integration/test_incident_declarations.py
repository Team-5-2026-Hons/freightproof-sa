"""Incident declarations: police and notification facts an operator records after an
incident, carried into audit packs under the Declared tier."""

import uuid
from collections.abc import AsyncGenerator
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.audit_packs import IncidentDeclaration
from app.db.session import get_db
from app.main import app
from app.orchestration.audit_pack_builder import build_audit_manifest
from app.orchestration.incident_declaration_service import list_declarations, record_declaration
from app.schemas.audit_pack import AuditPackOptions, IncidentDeclarationCreate

from tests.conftest import auth_header, make_token
from tests.integration.audit_pack_seed import T0, AuditTrip, seed_audit_trip

DECLARATIONS = "/api/v1/trips/{trip_id}/incident-declarations"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def audit_trip(db_session: AsyncSession) -> AuditTrip:
    return await seed_audit_trip(db_session)


def _request(**facts: object) -> IncidentDeclarationCreate:
    return IncidentDeclarationCreate.model_validate({
        "saps_station": "Harrismith SAPS", "saps_cas_number": "123/09/2026",
        "reported_to_saps_at": (T0 + timedelta(hours=5, minutes=40)).isoformat(), **facts,
    })


def _dispatcher(seed: AuditTrip) -> dict[str, str]:
    return auth_header(make_token(sub=str(seed.dispatcher.id), role="dispatcher", org_id=str(seed.org.id)))


async def test_record_declaration_persists_with_author(db_session, audit_trip):
    # Act
    row = await record_declaration(
        db_session, trip_id=audit_trip.trip.id, organization_id=audit_trip.org.id,
        user_id=audit_trip.dispatcher.id, request=_request(exception_id=str(audit_trip.panic.id)),
    )

    # Assert
    stored = (await db_session.execute(select(IncidentDeclaration))).scalar_one()
    assert stored.id == row.id
    assert stored.saps_cas_number == "123/09/2026"
    assert stored.exception_id == audit_trip.panic.id
    assert stored.declared_by_user_id == audit_trip.dispatcher.id


async def test_record_declaration_rejects_exception_from_another_trip(db_session, audit_trip):
    # Act / Assert
    with pytest.raises(ResourceNotFoundError):
        await record_declaration(
            db_session, trip_id=audit_trip.trip.id, organization_id=audit_trip.org.id,
            user_id=audit_trip.dispatcher.id, request=_request(exception_id=str(uuid.uuid4())),
        )


async def test_record_declaration_other_org_trip_raises(db_session, audit_trip):
    with pytest.raises(ResourceNotFoundError):
        await record_declaration(
            db_session, trip_id=audit_trip.trip.id, organization_id=uuid.uuid4(),
            user_id=audit_trip.dispatcher.id, request=_request(),
        )


async def test_list_declarations_names_the_declarer(db_session, audit_trip):
    # Arrange
    await record_declaration(db_session, trip_id=audit_trip.trip.id, organization_id=audit_trip.org.id,
                             user_id=audit_trip.dispatcher.id, request=_request())

    # Act
    records = await list_declarations(db_session, trip_id=audit_trip.trip.id, organization_id=audit_trip.org.id)

    # Assert
    assert [r.declared_by_name for r in records] == ["Ops Desk"]
    assert records[0].tier == "declared"


async def test_manifest_carries_declarations_and_their_observation(db_session, audit_trip):
    # Arrange
    await record_declaration(db_session, trip_id=audit_trip.trip.id, organization_id=audit_trip.org.id,
                             user_id=audit_trip.dispatcher.id, request=_request())

    # Act
    manifest = await build_audit_manifest(
        db_session, trip_id=audit_trip.trip.id, operator_organization_id=audit_trip.org.id,
        options=AuditPackOptions(), generated_at=T0 + timedelta(days=1),
    )

    # Assert
    assert [d.saps_cas_number for d in manifest.declarations] == ["123/09/2026"]
    saps = next(o for o in manifest.observations if o.code == "notifications.saps")
    assert "40 min after" in saps.text


async def test_manifest_without_declaration_asks_for_them(db_session, audit_trip):
    # Act
    manifest = await build_audit_manifest(
        db_session, trip_id=audit_trip.trip.id, operator_organization_id=audit_trip.org.id,
        options=AuditPackOptions(), generated_at=T0 + timedelta(days=1),
    )

    # Assert
    assert any(o.code == "notifications.undeclared" for o in manifest.observations)


async def test_post_declaration_endpoint_creates_and_lists(client: AsyncClient, audit_trip):
    # Act
    created = await client.post(
        DECLARATIONS.format(trip_id=audit_trip.trip.id), headers=_dispatcher(audit_trip),
        json={"saps_station": "Harrismith SAPS", "saps_cas_number": "123/09/2026",
              "reported_to_saps_at": "2026-09-12T11:40:00+00:00"},
    )
    listed = await client.get(DECLARATIONS.format(trip_id=audit_trip.trip.id), headers=_dispatcher(audit_trip))

    # Assert
    assert created.status_code == 201
    assert created.json()["saps_cas_number"] == "123/09/2026"
    assert [d["saps_station"] for d in listed.json()] == ["Harrismith SAPS"]


async def test_post_declaration_without_any_fact_is_422(client: AsyncClient, audit_trip):
    response = await client.post(DECLARATIONS.format(trip_id=audit_trip.trip.id), headers=_dispatcher(audit_trip),
                                 json={"note": "nothing yet"})
    assert response.status_code == 422


async def test_post_declaration_naive_time_is_422(client: AsyncClient, audit_trip):
    # A time without a zone is ambiguous by two hours in SAST — refused, not guessed.
    response = await client.post(DECLARATIONS.format(trip_id=audit_trip.trip.id), headers=_dispatcher(audit_trip),
                                 json={"reported_to_saps_at": "2026-09-12T11:40:00"})
    assert response.status_code == 422


async def test_post_declaration_unknown_trip_is_404(client: AsyncClient, audit_trip):
    response = await client.post(DECLARATIONS.format(trip_id=uuid.uuid4()), headers=_dispatcher(audit_trip),
                                 json={"saps_cas_number": "1/1/2026"})
    assert response.status_code == 404


async def test_post_declaration_expired_token_is_401(client: AsyncClient, audit_trip):
    token = make_token(sub=str(audit_trip.dispatcher.id), role="dispatcher", org_id=str(audit_trip.org.id), expires_in=-1)
    response = await client.post(DECLARATIONS.format(trip_id=audit_trip.trip.id), headers=auth_header(token),
                                 json={"saps_cas_number": "1/1/2026"})
    assert response.status_code == 401
