"""FP-83 C6: role-filtered trip reads after a handover, and the notice realtime ping.

What the driver app needs to stop sending writes without custody_sequence (driver_access on the
current driver's detail), what a former driver still sees (a history row, never live detail),
and what only a dispatcher sees (original driver, every arrangement, integrity, the flag).
"""

import uuid

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import _OUTBOX_KEY, RealtimeKind
from app.db.session import get_db
from app.main import app
from app.orchestration.substitutions.reads import get_driver_context
from app.orchestration.substitutions.service import arrange_substitution, cancel_substitution
from app.schemas.driver_substitutions import CancelSubstitutionRequest
from tests.integration._driver_substitution_world import driver_headers
from tests.integration.test_driver_substitution_endpoints import BASE, completed, dispatcher
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    arrangement, clock, world_with_licences,
)
from tests.integration.test_driver_substitution_service import dispatcher as service_dispatcher


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


async def test_the_new_driver_gets_driver_access_with_the_sequence_to_send(client: AsyncClient, db_session: AsyncSession):
    w, _ = await completed(client, db_session)

    active = await client.get(f"{BASE}/me/active", headers=driver_headers(w.b))
    detail = await client.get(f"{BASE}/me/{w.trip_id}", headers=driver_headers(w.b))

    assert active.status_code == 200 and active.json()["id"] == str(w.trip_id)
    for body in (active.json(), detail.json()):
        assert body["driver"]["id"] == str(w.b) and body["custody_sequence"] == 1
        assert body["driver_access"] == {
            "participation": "current", "custody_sequence": 1, "can_advance": True, "can_submit_late_evidence": False,
        }
        # Another person's driver record and the dispatcher's context never reach a driver.
        assert body["original_driver"] is None and body["driver_substitutions"] == []
        assert body["custody_integrity"] is None and body["driver_substitutions_enabled"] is None


async def test_the_former_driver_is_told_handed_over_and_keeps_a_history_row(client: AsyncClient, db_session: AsyncSession):
    w, _ = await completed(client, db_session)

    detail = await client.get(f"{BASE}/me/{w.trip_id}", headers=driver_headers(w.a))
    listed = await client.get(f"{BASE}/me", headers=driver_headers(w.a))
    newcomer = await client.get(f"{BASE}/me", headers=driver_headers(w.b))

    assert detail.status_code == 409 and detail.json()["detail"]["code"] == "TRIP_HANDED_OVER"
    [row] = [r for r in listed.json() if r["id"] == str(w.trip_id)]
    assert (row["participation"], row["custody_sequence"], row["status"]) == ("former", 0, "active")
    assert row["last_participation_ended_at"] is not None
    [taken] = [r for r in newcomer.json() if r["id"] == str(w.trip_id)]
    assert (taken["participation"], taken["custody_sequence"], taken["last_participation_ended_at"]) == ("current", 1, None)


async def test_the_dispatcher_detail_shows_derived_and_original_drivers_and_the_chain(client: AsyncClient, db_session: AsyncSession):
    w, done = await completed(client, db_session)

    body = (await client.get(f"{BASE}/{w.trip_id}", headers=dispatcher(w))).json()

    assert (body["driver"]["id"], body["original_driver"]["id"], body["custody_sequence"]) == (str(w.b), str(w.a), 1)
    assert [r["id"] for r in body["driver_substitutions"]] == [done["id"]]
    assert body["pending_driver_substitution"] is None and body["driver_access"] is None
    assert body["driver_substitutions_enabled"] is True
    assert body["custody_integrity"]["amendment_count"] == 1 and body["custody_integrity"]["status"] == "pending"


async def test_the_dispatcher_list_names_the_current_driver(client: AsyncClient, db_session: AsyncSession):
    w, _ = await completed(client, db_session)

    rows = (await client.get(f"{BASE}", headers=dispatcher(w))).json()

    [row] = [r for r in rows if r["id"] == str(w.trip_id)]
    assert row["driver"]["id"] == str(w.b)


async def test_a_cancelled_arrangement_is_a_snapshot_without_live_context(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=service_dispatcher(w), payload=arrangement(w))
    live = await get_driver_context(db_session, trip_id=w.trip_id, request_id=pending.id, driver_id=w.b)
    await cancel_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=service_dispatcher(w),
        payload=CancelSubstitutionRequest(client_request_id=uuid.uuid4(), expected_version=1, reason="Not needed"),
    )

    snapshot = await get_driver_context(db_session, trip_id=w.trip_id, request_id=pending.id, driver_id=w.b)

    assert live.remaining_stops != []
    assert (snapshot.state.value, snapshot.remaining_stops, snapshot.findings, snapshot.current_phase) == (
        "cancelled", [], [], None,
    )
    assert snapshot.exchange.label == "Beaufort West depot"


async def test_each_lifecycle_change_queues_one_dispatcher_refetch(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    before = len(db_session.info.get(_OUTBOX_KEY, []))

    await arrange_substitution(db_session, trip_id=w.trip_id, actor=service_dispatcher(w), payload=arrangement(w))

    queued = db_session.info.get(_OUTBOX_KEY, [])[before:]
    assert [(org, event.kind, event.id) for org, event in queued] == [
        (w.org_id, RealtimeKind.DRIVER_SUBSTITUTION_CHANGED, w.trip_id),
    ]


async def test_a_confirmation_through_http_carries_on_after_the_read(client: AsyncClient, db_session: AsyncSession):
    """The driver reads its access, then writes with that sequence: the integration the app needs."""
    w, _ = await completed(client, db_session)
    access = (await client.get(f"{BASE}/me/active", headers=driver_headers(w.b))).json()["driver_access"]

    checkpoint = await client.post(
        f"{BASE}/{w.trip_id}/checkpoints",
        json={"checkpoint_type": "routine", "custody_sequence": access["custody_sequence"]},
        headers=driver_headers(w.b),
    )
    missing = await client.post(f"{BASE}/{w.trip_id}/checkpoints", json={"checkpoint_type": "routine"}, headers=driver_headers(w.b))

    assert checkpoint.status_code in (200, 201), checkpoint.text
    assert missing.status_code == 409 and missing.json()["detail"]["code"] == "CUSTODY_CONTEXT_REQUIRED"


async def test_an_exception_row_names_the_driver_who_raised_it_after_a_handover(db_session: AsyncSession):
    from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, ExceptionSource, ExceptionType
    from app.db.models.transit import TripException
    from app.db.models.trips import Trip
    from app.orchestration.exceptions.queries import _load_trip_contexts
    from tests.integration._driver_substitution_world import complete_handover

    w = await world_with_licences(db_session)
    await complete_handover(db_session, w, outgoing=w.a, incoming=w.b)
    trip = await db_session.get(Trip, w.trip_id)
    assert trip is not None

    def report(actor: uuid.UUID | None) -> TripException:
        return TripException(
            trip_id=w.trip_id, exception_type=ExceptionType.MECHANICAL, severity=ExceptionSeverity.WARNING,
            source=ExceptionSource.DRIVER if actor else ExceptionSource.SYSTEM,
            review_status=ExceptionReviewStatus.NEEDS_REVIEW, description="x", performed_by_driver_id=actor,
        )

    [context] = (await _load_trip_contexts(db_session, [trip])).values()
    names = {driver_id: name for driver_id, name in context.participant_names.items()}

    assert context.driver_for(report(w.b)) == names[w.b]
    assert context.driver_for(report(w.a)) == names[w.a]
    # A system finding on a shared trip has no actor: no one is blamed for it.
    assert context.driver_for(report(None)) is None
