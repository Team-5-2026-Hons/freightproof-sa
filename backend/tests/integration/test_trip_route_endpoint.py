"""Integration tests for GET /trips/me/{trip_id}/route (driver PWA route + ETA).

The ORS client and the Redis client are both faked: these tests prove the
endpoint/orchestration contract (ownership, stop ordering, leg labelling,
caching, every failure degrading to null). The vendor parsing is covered by
tests/unit/test_routing.py.
"""

import uuid
from collections.abc import Sequence

import pytest
import pytest_asyncio
from httpx import AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.integrations.routing import (
    PlannedRoute, RouteLeg, RoutePoint, RoutingError, RoutingNotConfiguredError,
)
from app.main import app

from tests.conftest import auth_header, make_token

_ROUTE_MODULE = "app.orchestration.trips.route"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


class FakeRedis:
    """Just the two calls the route cache makes."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value


class DownRedis:
    async def get(self, key: str) -> str | None:
        raise RedisConnectionError("redis down")

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        raise RedisConnectionError("redis down")


class FakeRouter:
    """Stands in for compute_truck_route: records calls, returns one straight leg per pair."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[list[RoutePoint]] = []
        self.error = error

    async def __call__(self, points: Sequence[RoutePoint]) -> PlannedRoute:
        self.calls.append(list(points))
        if self.error is not None:
            raise self.error
        return PlannedRoute(
            legs=tuple(
                RouteLeg(
                    distance_metres=1000.0 * (index + 1),
                    duration_seconds=60.0 * (index + 1),
                    coordinates=((a.lat, a.lng), (b.lat, b.lng)),
                )
                for index, (a, b) in enumerate(zip(points, points[1:]))
            )
        )


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    redis = FakeRedis()
    monkeypatch.setattr(f"{_ROUTE_MODULE}.get_redis", lambda: redis)
    return redis


def install_router(monkeypatch: pytest.MonkeyPatch, router: FakeRouter) -> FakeRouter:
    monkeypatch.setattr(f"{_ROUTE_MODULE}.compute_truck_route", router)
    return router


async def make_trip(db_session, *, stop_count: int = 3) -> dict:
    """A trip with `stop_count` stops at distinct coordinates, inserted out of sequence
    order so the test proves the route follows sequence, not insertion."""
    org = Organization(id=uuid.uuid4(), name="Op", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()

    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"{uuid.uuid4().hex}@t.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number=f"DRV-{uuid.uuid4().hex[:6]}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"R{uuid.uuid4().hex[:6]}", pulsit_device_id=f"PUL-{uuid.uuid4().hex[:6]}",
    )
    precincts = [
        Precinct(
            id=uuid.uuid4(), name=f"P{i}", principal_organization_id=org.id,
            latitude=str(-26 - i), longitude=str(28 + i),
        )
        for i in range(stop_count)
    ]
    db_session.add_all([user, driver, horse, *precincts])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{uuid.uuid4().hex[:6]}",
        operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    for i in reversed(range(stop_count)):
        db_session.add(TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=precincts[i].id, sequence=i + 1))
    await db_session.flush()

    return {"trip": trip, "driver": driver, "org": org}


def driver_headers(driver: Driver) -> dict[str, str]:
    return auth_header(make_token(sub=str(driver.id), role="driver"))


async def test_route_returns_legs_in_stop_sequence(client: AsyncClient, db_session, fake_redis, monkeypatch):
    seeded = await make_trip(db_session)
    router = install_router(monkeypatch, FakeRouter())

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 200
    body = resp.json()
    assert body["trip_id"] == str(seeded["trip"].id)
    assert body["profile"] == "driving-hgv"
    assert [(leg["from_stop_sequence"], leg["to_stop_sequence"]) for leg in body["legs"]] == [(1, 2), (2, 3)]
    assert [(p.lat, p.lng) for p in router.calls[0]] == [(-26.0, 28.0), (-27.0, 29.0), (-28.0, 30.0)]
    assert body["legs"][0]["coordinates"] == [[-26.0, 28.0], [-27.0, 29.0]]
    assert body["distance_metres"] == 3000.0
    assert body["duration_seconds"] == 180.0


async def test_route_second_request_is_served_from_cache(client: AsyncClient, db_session, fake_redis, monkeypatch):
    seeded = await make_trip(db_session)
    router = install_router(monkeypatch, FakeRouter())
    url = f"/api/v1/trips/me/{seeded['trip'].id}/route"

    # One token for both: minting a second would trip the one-device session rule.
    headers = driver_headers(seeded["driver"])
    first = await client.get(url, headers=headers)
    second = await client.get(url, headers=headers)

    assert first.json() == second.json()
    assert len(router.calls) == 1
    assert f"trip_route:v1:{seeded['trip'].id}" in fake_redis.store


async def test_route_without_credentials_returns_403(client: AsyncClient, db_session, fake_redis):
    # 403, not 401: matches every other /trips/me endpoint (HTTPBearer's missing-header response).
    seeded = await make_trip(db_session)

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route")

    assert resp.status_code == 403


async def test_route_with_invalid_token_returns_401(client: AsyncClient, db_session, fake_redis):
    seeded = await make_trip(db_session)

    resp = await client.get(
        f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=auth_header("not.a.valid-jwt"),
    )

    assert resp.status_code == 401


async def test_route_for_another_drivers_trip_returns_404(client: AsyncClient, db_session, fake_redis, monkeypatch):
    seeded = await make_trip(db_session)
    other = await make_trip(db_session)
    router = install_router(monkeypatch, FakeRouter())

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=driver_headers(other["driver"]))

    assert resp.status_code == 404
    assert router.calls == []


async def test_route_for_unknown_trip_returns_404(client: AsyncClient, db_session, fake_redis):
    seeded = await make_trip(db_session)

    resp = await client.get(f"/api/v1/trips/me/{uuid.uuid4()}/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 404


async def test_route_with_malformed_trip_id_returns_422(client: AsyncClient, db_session, fake_redis):
    seeded = await make_trip(db_session)

    resp = await client.get("/api/v1/trips/me/not-a-uuid/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 422


async def test_route_without_ors_key_returns_null(client: AsyncClient, db_session, fake_redis, monkeypatch):
    seeded = await make_trip(db_session)
    install_router(monkeypatch, FakeRouter(error=RoutingNotConfiguredError("no key")))

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 200
    assert resp.json() is None
    assert fake_redis.store == {}


async def test_route_provider_failure_returns_null_and_is_not_cached(
    client: AsyncClient, db_session, fake_redis, monkeypatch,
):
    seeded = await make_trip(db_session)
    router = install_router(monkeypatch, FakeRouter(error=RoutingError("ORS 503")))
    url = f"/api/v1/trips/me/{seeded['trip'].id}/route"

    # One token for both: minting a second would trip the one-device session rule.
    headers = driver_headers(seeded["driver"])
    first = await client.get(url, headers=headers)
    second = await client.get(url, headers=headers)

    assert first.json() is None
    assert second.json() is None
    assert len(router.calls) == 2
    assert fake_redis.store == {}


async def test_route_with_single_stop_returns_null(client: AsyncClient, db_session, fake_redis, monkeypatch):
    seeded = await make_trip(db_session, stop_count=1)
    router = install_router(monkeypatch, FakeRouter())

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 200
    assert resp.json() is None
    assert router.calls == []


async def test_route_when_redis_is_down_still_returns_route(client: AsyncClient, db_session, monkeypatch):
    seeded = await make_trip(db_session)
    monkeypatch.setattr(f"{_ROUTE_MODULE}.get_redis", lambda: DownRedis())
    install_router(monkeypatch, FakeRouter())

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 200
    assert len(resp.json()["legs"]) == 2


async def test_route_discards_unreadable_cache_entry(client: AsyncClient, db_session, fake_redis, monkeypatch):
    seeded = await make_trip(db_session)
    fake_redis.store[f"trip_route:v1:{seeded['trip'].id}"] = '{"not": "a route"}'
    router = install_router(monkeypatch, FakeRouter())

    resp = await client.get(f"/api/v1/trips/me/{seeded['trip'].id}/route", headers=driver_headers(seeded["driver"]))

    assert resp.status_code == 200
    assert len(resp.json()["legs"]) == 2
    assert len(router.calls) == 1
