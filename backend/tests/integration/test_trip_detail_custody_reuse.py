"""GET /trips/{id} builds its driver-handover fields from rows get_trip_detail already loaded
(Batch E). These tests pin that the shortcut changes the number of statements and nothing else:
the fields equal what the standalone readers return, and the organisation check still holds.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import IdvsStatus
from app.db.session import get_db
from app.main import app
from app.orchestration.substitutions.anchors import verify_custody_chain
from app.orchestration.substitutions.reads import (
    list_completed_substitutions,
    list_trip_requests,
    with_dispatcher_custody,
)
from app.orchestration.trips.detail import TripReadFacts, get_trip_detail
from app.schemas.driver_substitutions import SubstitutionCompletionMode, SubstitutionState
from app.schemas.people import UserRead
from tests.conftest import auth_header, make_token
from tests.integration._driver_substitution_world import (
    SubWorld,
    add_pending,
    build_world,
    complete_handover,
)


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def stub_signed_urls(monkeypatch):
    async def _fake(*, s3_bucket, s3_key, ttl_seconds):
        return f"https://storage.test/{s3_key}?ttl={ttl_seconds}"
    monkeypatch.setattr("app.orchestration.evidence.artifacts.create_signed_url", _fake)


async def _handed_over_with_pending(db_session) -> SubWorld:
    """A -> B completed, and a pending B -> C: both kinds of request on one trip."""
    world = await build_world(db_session)
    handover = await complete_handover(db_session, world, outgoing=world.a, incoming=world.b)
    # A completed request is read against the identity it froze at completion.
    handover.incoming_identity_status = IdvsStatus.VERIFIED.value
    handover.incoming_identity_last_verified_at = datetime.now(UTC)
    handover.incoming_identity_observed_at = datetime.now(UTC)
    handover.completion_mode = SubstitutionCompletionMode.NORMAL.value
    await db_session.flush()
    await add_pending(
        db_session, world, outgoing=world.b, incoming=world.c,
        expected_at=datetime.now(UTC) + timedelta(hours=2),
    )
    return world


def _dispatcher(world: SubWorld, *, organization_id: uuid.UUID | None = None) -> UserRead:
    now = datetime.now(UTC)
    return UserRead(
        id=world.user_id, organization_id=organization_id or world.org_id, email="d@test.co.za",
        full_name="D", created_at=now, updated_at=now,
    )


def _stable(requests: list[dict]) -> list[dict]:
    """A pending request reports the incoming driver's identity as observed 'now', which differs
    between two reads; every other field must match exactly."""
    return [
        {**r, "identity": {**r["identity"], "observed_at": None}} if r["state"] == SubstitutionState.PENDING else r
        for r in requests
    ]


async def test_trip_detail_custody_fields_equal_the_standalone_readers(client, db_session):
    world = await _handed_over_with_pending(db_session)
    headers = auth_header(make_token(sub=str(world.user_id), role="dispatcher", org_id=str(world.org_id)))
    actor = _dispatcher(world)

    response = await client.get(f"/api/v1/trips/{world.trip_id}", headers=headers)

    assert response.status_code == 200
    body = response.json()
    requests = await list_trip_requests(db_session, trip_id=world.trip_id, actor=actor)
    completed = await list_completed_substitutions(db_session, trip_id=world.trip_id, actor=actor)
    integrity = await verify_custody_chain(db_session, trip_id=world.trip_id, organization_id=world.org_id)
    assert [r["id"] for r in body["driver_substitutions"]] == [str(r.id) for r in requests]
    assert {r["state"] for r in body["driver_substitutions"]} == {SubstitutionState.COMPLETED, SubstitutionState.PENDING}
    assert [c["substitution_id"] for c in body["completed_driver_substitutions"]] == [str(c.substitution_id) for c in completed]
    assert body["pending_driver_substitution"]["id"] == str(next(r.id for r in requests if r.state is SubstitutionState.PENDING))
    assert body["custody_integrity"] == integrity.model_dump(mode="json")
    # Whole-field equality, not just ids: the shortcut must not change what a request says.
    assert _stable(body["driver_substitutions"]) == _stable([r.model_dump(mode="json") for r in requests])
    assert body["completed_driver_substitutions"] == [c.model_dump(mode="json") for c in completed]


async def test_custody_fields_refuse_facts_from_another_organisation(db_session):
    world = await _handed_over_with_pending(db_session)
    facts = TripReadFacts()
    detail = await get_trip_detail(db_session, world.trip_id, world.org_id, facts=facts)
    outsider = _dispatcher(world, organization_id=world.other_org_id)

    with pytest.raises(ResourceNotFoundError):
        await with_dispatcher_custody(db_session, detail, actor=outsider, facts=facts)


async def test_custody_fields_refuse_facts_that_were_never_loaded(db_session):
    world = await _handed_over_with_pending(db_session)
    detail = await get_trip_detail(db_session, world.trip_id, world.org_id)

    with pytest.raises(ResourceNotFoundError):
        await with_dispatcher_custody(db_session, detail, actor=_dispatcher(world), facts=TripReadFacts())


async def test_custody_integrity_refuses_a_preloaded_trip_of_another_organisation(db_session):
    from app.db.models.trips import Trip
    from app.orchestration.substitutions.anchors import LoadedChain

    world = await _handed_over_with_pending(db_session)
    trip = await db_session.get(Trip, world.trip_id)

    with pytest.raises(ResourceNotFoundError):
        await verify_custody_chain(
            db_session, trip_id=world.trip_id, organization_id=world.other_org_id,
            loaded=LoadedChain(trip=trip, rows=[], requests=[]),
        )
