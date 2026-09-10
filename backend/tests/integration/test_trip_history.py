"""Integration contract for the dispatcher's cursor-paginated trip history."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from typing import TypedDict, Unpack

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.enums import IdvsStatus, OrganizationType, TripStatus, TripType, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

_HISTORY = "/api/v1/trips/history"


class HistorySeed(TypedDict):
    org: Organization
    client_org: Organization
    dispatcher: User
    driver: Driver
    horse: Vehicle
    origin: Precinct
    dest: Precinct


class TripOverrides(TypedDict, total=False):
    id: uuid.UUID
    trip_reference: str
    order_number: str
    driver_id: uuid.UUID
    origin_precinct_id: uuid.UUID | None
    destination_precinct_id: uuid.UUID | None
    status: TripStatus
    closed_at: datetime | None


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


def _headers(seed: HistorySeed) -> dict[str, str]:
    return auth_header(make_token(
        sub=str(seed["dispatcher"].id),
        role="dispatcher",
        org_id=str(seed["org"].id),
    ))


async def _make_trip(
    db_session: AsyncSession,
    seed: HistorySeed,
    *,
    tag: str,
    **overrides: Unpack[TripOverrides],
) -> Trip:
    defaults: dict[str, object] = dict(
        id=uuid.uuid4(),
        trip_reference=f"FP-HISTORY-{tag}",
        order_number=f"ORDER-{tag}",
        operator_organization_id=seed["org"].id,
        client_organization_id=seed["client_org"].id,
        driver_id=seed["driver"].id,
        horse_id=seed["horse"].id,
        origin_precinct_id=seed["origin"].id,
        destination_precinct_id=seed["dest"].id,
        status=TripStatus.CLOSED,
        trip_type=TripType.LOADED,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed["dispatcher"].id,
        closed_at=datetime(2026, 4, 1, 10, 0, tzinfo=UTC),
    )
    defaults.update(overrides)
    trip = Trip(**defaults)
    db_session.add(trip)
    await db_session.flush()
    return trip


async def _seed_other_org(db_session: AsyncSession, *, tag: str) -> HistorySeed:
    org = Organization(id=uuid.uuid4(), name=f"Other {tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Other Client {tag}", org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([org, client_org])
    await db_session.flush()

    dispatcher = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"other-{tag}@test.co.za", full_name="Other Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other Driver",
        id_number="9001015009088", phone_number="+27820000000",
        license_number=f"OTHER-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"OTH-{tag}", pulsit_device_id=f"PUL-OTHER-{tag}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="Other origin", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="Other destination", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    db_session.add_all([dispatcher, driver, horse, origin, dest])
    await db_session.flush()
    return {
        "org": org,
        "client_org": client_org,
        "dispatcher": dispatcher,
        "driver": driver,
        "horse": horse,
        "origin": origin,
        "dest": dest,
    }


async def test_existing_trip_list_contract_remains_an_array(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    await _make_trip(db_session, seed, tag="compatibility")

    response = await client.get("/api/v1/trips", headers=_headers(seed))

    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_history_returns_only_terminal_trips_ordered_by_closed_at(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    older = await _make_trip(
        db_session, seed, tag="older", closed_at=datetime(2026, 4, 2, 10, 0, tzinfo=UTC),
    )
    newer = await _make_trip(
        db_session, seed, tag="newer", status=TripStatus.CANCELLED,
        closed_at=datetime(2026, 4, 3, 10, 0, tzinfo=UTC),
    )
    # A later updated_at must not move an older closure above the newer closure.
    older.updated_at = datetime(2026, 5, 1, 10, 0, tzinfo=UTC)
    await _make_trip(
        db_session, seed, tag="active", status=TripStatus.ACTIVE, closed_at=None,
    )
    await db_session.flush()

    response = await client.get(_HISTORY, headers=_headers(seed))

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["items"]] == [str(newer.id), str(older.id)]
    assert body["total_items"] == 2
    assert body["next_cursor"] is None
    assert newer.closed_at is not None
    assert body["items"][0]["closed_at"] == newer.closed_at.isoformat().replace("+00:00", "Z")


async def test_history_row_is_lightweight_but_complete_for_checklist_row(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    trip = await _make_trip(db_session, seed, tag="shape")

    response = await client.get(_HISTORY, headers=_headers(seed))

    assert response.status_code == 200
    row = next(item for item in response.json()["items"] if item["id"] == str(trip.id))
    assert set(row) == {
        "id", "trip_reference", "order_number", "status", "driver", "horse",
        "origin_precinct_id", "destination_precinct_id", "needs_review_count",
        "current_phase", "current_stop", "phase_total", "phase_completed",
        "closed_at", "created_at",
    }
    assert set(row["driver"]) == {"full_name"}
    assert row["driver"]["full_name"] == seed["driver"].full_name
    assert set(row["horse"]) == {"registration"}
    assert row["horse"]["registration"] == seed["horse"].registration
    assert row["needs_review_count"] == 0
    assert row["phase_total"] == 0
    assert row["phase_completed"] == 0


async def test_history_accepts_nullable_origin_and_destination(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    trip = await _make_trip(
        db_session,
        seed,
        tag="nullable-route",
        origin_precinct_id=None,
        destination_precinct_id=None,
    )

    response = await client.get(_HISTORY, headers=_headers(seed))

    assert response.status_code == 200
    row = next(item for item in response.json()["items"] if item["id"] == str(trip.id))
    assert row["origin_precinct_id"] is None
    assert row["destination_precinct_id"] is None


async def test_history_is_org_scoped_in_both_items_and_total(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    own = await _make_trip(db_session, seed, tag="own")
    other_seed = await _seed_other_org(db_session, tag="scope")
    await _make_trip(db_session, other_seed, tag="cross-org")

    response = await client.get(_HISTORY, headers=_headers(seed))

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["items"]] == [str(own.id)]
    assert response.json()["total_items"] == 1


async def test_history_cursor_pages_tied_closed_at_without_duplicates_or_skips(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    tied_at = datetime(2026, 4, 4, 10, 0, tzinfo=UTC)
    trips = [
        await _make_trip(
            db_session, seed, tag=f"tie-{i}", id=uuid.UUID(int=10_000 + i), closed_at=tied_at,
        )
        for i in range(7)
    ]
    expected = [str(trip.id) for trip in sorted(trips, key=lambda trip: trip.id, reverse=True)]

    seen: list[str] = []
    cursor = None
    totals: list[int] = []
    for _ in range(4):
        params: dict[str, str | int] = {"limit": 3}
        if cursor is not None:
            params["cursor"] = cursor
        response = await client.get(_HISTORY, params=params, headers=_headers(seed))
        assert response.status_code == 200
        body = response.json()
        seen.extend(row["id"] for row in body["items"])
        totals.append(body["total_items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert cursor is None
    assert seen == expected
    assert totals == [7, 7, 7]


async def test_history_search_matches_trip_reference_order_and_driver_name(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    reference_match = await _make_trip(
        db_session, seed, tag="ref-needle", trip_reference="FP-SPECIAL-REFERENCE",
    )
    order_match = await _make_trip(
        db_session, seed, tag="order-needle", order_number="ORDER-SPECIAL-991",
    )
    named_driver = Driver(
        id=uuid.uuid4(), organization_id=seed["org"].id, full_name="Nomvula Searchable",
        id_number="9101015009089", phone_number="+27821111111", license_number="DRV-SEARCH",
    )
    db_session.add(named_driver)
    await db_session.flush()
    driver_match = await _make_trip(
        db_session, seed, tag="driver-needle", driver_id=named_driver.id,
    )
    await _make_trip(db_session, seed, tag="unmatched")

    cases: list[tuple[str, uuid.UUID]] = [
        ("special-reference", reference_match.id),
        ("special-991", order_match.id),
        ("nomvula", driver_match.id),
    ]
    for query, expected_id in cases:
        response = await client.get(_HISTORY, params={"q": query}, headers=_headers(seed))
        assert response.status_code == 200
        assert [row["id"] for row in response.json()["items"]] == [str(expected_id)]
        assert response.json()["total_items"] == 1


@pytest.mark.parametrize(
    ("query", "expected_reference"),
    [("%", "FP-LITERAL%MARK"), ("_", "FP-LITERAL_MARK")],
)
async def test_history_search_treats_sql_wildcards_as_literal_characters(
    client: AsyncClient,
    db_session: AsyncSession,
    seed: HistorySeed,
    query: str,
    expected_reference: str,
):
    await _make_trip(
        db_session, seed, tag="literal-percent", trip_reference="FP-LITERAL%MARK",
    )
    await _make_trip(
        db_session, seed, tag="literal-underscore", trip_reference="FP-LITERAL_MARK",
    )
    await _make_trip(
        db_session, seed, tag="ordinary", trip_reference="FP-LITERAL-X-MARK",
    )

    response = await client.get(_HISTORY, params={"q": query}, headers=_headers(seed))

    assert response.status_code == 200
    assert [row["trip_reference"] for row in response.json()["items"]] == [
        expected_reference,
    ]
    assert response.json()["total_items"] == 1


async def test_history_precinct_filter_matches_origin_or_destination(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    third = Precinct(
        id=uuid.uuid4(), name="Third", principal_organization_id=seed["client_org"].id,
        latitude="2", longitude="2",
    )
    db_session.add(third)
    await db_session.flush()
    origin_match = await _make_trip(
        db_session, seed, tag="origin-match", origin_precinct_id=third.id,
    )
    destination_match = await _make_trip(
        db_session, seed, tag="destination-match", destination_precinct_id=third.id,
    )
    await _make_trip(db_session, seed, tag="route-unmatched")

    response = await client.get(
        _HISTORY, params={"precinct_id": str(third.id)}, headers=_headers(seed),
    )

    assert response.status_code == 200
    assert {row["id"] for row in response.json()["items"]} == {
        str(origin_match.id), str(destination_match.id),
    }
    assert response.json()["total_items"] == 2


async def test_history_date_range_is_inclusive_in_configured_operations_timezone(
    client: AsyncClient,
    db_session: AsyncSession,
    seed: HistorySeed,
    monkeypatch: pytest.MonkeyPatch,
):
    # A non-default offset proves the endpoint reads the shared setting instead of
    # embedding South Africa's current UTC offset as a second constant.
    monkeypatch.setattr(settings, "OPERATIONS_UTC_OFFSET_HOURS", 3)
    boundary_date = date(2026, 4, 10)
    inside_start = await _make_trip(
        db_session, seed, tag="date-in-start",
        closed_at=datetime(2026, 4, 9, 21, 0, tzinfo=UTC),
    )
    await _make_trip(
        db_session, seed, tag="date-out-start",
        closed_at=datetime(2026, 4, 9, 20, 59, tzinfo=UTC),
    )
    inside_end = await _make_trip(
        db_session, seed, tag="date-in-end",
        closed_at=datetime(2026, 4, 10, 20, 59, tzinfo=UTC),
    )
    await _make_trip(
        db_session, seed, tag="date-out-end",
        closed_at=datetime(2026, 4, 10, 21, 0, tzinfo=UTC),
    )

    response = await client.get(
        _HISTORY,
        params={"from_date": boundary_date.isoformat(), "to_date": boundary_date.isoformat()},
        headers=_headers(seed),
    )

    assert response.status_code == 200
    assert {row["id"] for row in response.json()["items"]} == {
        str(inside_start.id), str(inside_end.id),
    }
    assert response.json()["total_items"] == 2


async def test_history_accepts_maximum_to_date_without_overflow(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    trip = await _make_trip(
        db_session,
        seed,
        tag="maximum-to-date",
        closed_at=datetime(9999, 12, 31, 20, 0, tzinfo=UTC),
    )

    response = await client.get(
        _HISTORY,
        params={"to_date": date.max.isoformat()},
        headers=_headers(seed),
    )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["items"]] == [str(trip.id)]
    assert response.json()["total_items"] == 1


@pytest.mark.parametrize("limit", [1, 100])
async def test_history_accepts_limit_bounds(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed, limit: int,
):
    await _make_trip(db_session, seed, tag=f"valid-limit-{limit}")

    response = await client.get(_HISTORY, params={"limit": limit}, headers=_headers(seed))

    assert response.status_code == 200


@pytest.mark.parametrize("limit", [0, 101])
async def test_history_rejects_limit_outside_bounds(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed, limit: int,
):
    response = await client.get(_HISTORY, params={"limit": limit}, headers=_headers(seed))

    assert response.status_code == 422


async def test_history_rejects_malformed_cursor(
    client: AsyncClient, db_session: AsyncSession, seed: HistorySeed,
):
    response = await client.get(
        _HISTORY, params={"cursor": "not-a-real-cursor"}, headers=_headers(seed),
    )

    assert response.status_code == 422


async def test_history_requires_dispatcher_authentication(client: AsyncClient):
    response = await client.get(_HISTORY)

    assert response.status_code == 403


async def test_history_does_not_misreport_non_cursor_value_errors_as_422(
    client: AsyncClient,
    db_session: AsyncSession,
    seed: HistorySeed,
    monkeypatch: pytest.MonkeyPatch,
):
    async def _broken_history_query(*args: object, **kwargs: object) -> None:
        raise ValueError("response construction defect")

    monkeypatch.setattr("app.api.v1.endpoints.trips.list_trip_history", _broken_history_query)

    with pytest.raises(ValueError, match="response construction defect"):
        await client.get(_HISTORY, headers=_headers(seed))
