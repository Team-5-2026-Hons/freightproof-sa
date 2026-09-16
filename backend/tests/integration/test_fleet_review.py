"""Integration contract for GET /api/v1/analytics/fleet/review (fleet analytics spec §5.4).

Charts 4.1–4.4 over one seeded fortnight (two whole past weeks, built from "now"):
  E1 critical, raised day 0 10:00, reviewed day 2 10:00 (48 h)   evidence_verified
  E2 critical, raised day 1 10:00, reviewed day 9 10:00 (192 h)  data_discrepancy
  E8 critical, raised day 3 10:00, reviewed day 10 10:00 (168 h) referred_for_follow_up
  E3 critical, raised day 8 10:00, still waiting
  E4 critical, legacy_review marker, never counted anywhere
  E5 warning, reviewed day 3: counts only in the outcomes chart (all severities)
  E6 critical, raised 30 minutes ago, still waiting: after the period, so only in "waiting now"
Plus another operator's critical exception, which must never count.
"""

from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import (
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionType,
    TripStatus,
)
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    Operator,
    add_exception,
    at_sast,
    headers,
    operator_from_seed,
    other_operator,
    seed_trip,
    today_sast,
)

_REVIEW = "/api/v1/analytics/fleet/review"
_WEEKS_BACK = 4
_OUTCOMES = ["no_action_required", "handled_externally", "evidence_verified", "data_discrepancy", "referred_for_follow_up"]
_AGE_BANDS = ["under_1h", "1h_to_24h", "1d_to_3d", "over_3d"]


def _week0() -> date:
    today = today_sast()
    return today - timedelta(days=today.weekday(), weeks=_WEEKS_BACK)


def _day(offset: int) -> date:
    return _week0() + timedelta(days=offset)


def _params() -> dict[str, str]:
    return {"start": _day(0).isoformat(), "end": _day(13).isoformat(), "grain": "week"}


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session: AsyncSession) -> AsyncIterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def operator(seed: dict[str, Any]) -> Operator:
    return operator_from_seed(seed)


@pytest.fixture
def stops(seed: dict[str, Any]) -> list[Precinct]:
    return [seed["origin"], seed["dest"]]


async def _seed_reviews(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> None:
    # An open trip on purpose: the review desk is not limited to closed trips.
    trip = (await seed_trip(db, operator, stops=stops, start=at_sast(_day(0), 6), status=TripStatus.ACTIVE)).trip
    critical, warning = ExceptionSeverity.CRITICAL, ExceptionSeverity.WARNING
    reviewed, waiting = ExceptionReviewStatus.REVIEWED, ExceptionReviewStatus.NEEDS_REVIEW
    outcome = ExceptionReviewOutcome
    for severity, raised, reviewed_at, status, verdict in (
        (critical, at_sast(_day(0), 10), at_sast(_day(2), 10), reviewed, outcome.EVIDENCE_VERIFIED),
        (critical, at_sast(_day(1), 10), at_sast(_day(9), 10), reviewed, outcome.DATA_DISCREPANCY),
        (critical, at_sast(_day(3), 10), at_sast(_day(10), 10), reviewed, outcome.REFERRED_FOR_FOLLOW_UP),
        (critical, at_sast(_day(8), 10), None, waiting, None),
        (critical, at_sast(_day(0), 9), at_sast(_day(1), 9), reviewed, outcome.LEGACY_REVIEW),
        (warning, at_sast(_day(2), 9), at_sast(_day(3), 9), reviewed, outcome.NO_ACTION_REQUIRED),
        (critical, datetime.now(UTC) - timedelta(minutes=30), None, waiting, None),
    ):
        await add_exception(
            db, trip, exception_type=ExceptionType.SEAL_MISMATCH, severity=severity, created_at=raised,
            review_status=status, reviewed_at=reviewed_at, review_outcome=verdict,
        )
    other = await other_operator(db)
    stranger = (await seed_trip(db, other, stops=stops, start=at_sast(_day(0), 6))).trip
    await add_exception(
        db, stranger, exception_type=ExceptionType.PANIC_BUTTON, severity=critical, created_at=at_sast(_day(1), 9),
        review_status=reviewed, reviewed_at=at_sast(_day(2), 9), review_outcome=outcome.EVIDENCE_VERIFIED,
    )
    await add_exception(
        db, stranger, exception_type=ExceptionType.PANIC_BUTTON, severity=critical, created_at=at_sast(_day(1), 9),
        review_status=waiting,
    )


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_review_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_REVIEW, params=_params())

    assert response.status_code == 403


async def test_fleet_review_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_REVIEW, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_review_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_REVIEW, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_review_rejects_an_end_after_today(client: AsyncClient, operator: Operator) -> None:
    params = {"end": (today_sast() + timedelta(days=1)).isoformat(), "grain": "week"}

    response = await client.get(_REVIEW, params=params, headers=headers(operator))

    assert response.status_code == 422


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_review_for_an_org_without_exceptions_is_empty_but_complete(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_REVIEW, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert body["waiting_by_age"] == [{"band": band, "count": 0} for band in _AGE_BANDS]
    assert [row["waiting_at_end"] for row in body["queue"]] == [0, 0]
    assert [(row["reviewed_count"], row["median_hours"]) for row in body["time_to_review"]] == [(0, None), (0, None)]
    assert body["outcomes"] == [{"outcome": outcome, "count": 0} for outcome in _OUTCOMES]


async def test_fleet_review_waiting_now_bands_the_open_queue_by_age(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_reviews(db_session, operator, stops)

    response = await client.get(_REVIEW, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    # E6 (30 minutes old) and E3 (weeks old); the other operator's waiting item never counts.
    assert [bar["count"] for bar in response.json()["waiting_by_age"]] == [1, 0, 0, 1]


async def test_fleet_review_queue_counts_items_raised_before_and_reviewed_after_each_bucket_end(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_reviews(db_session, operator, stops)

    response = await client.get(_REVIEW, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    # End of week 0: E2 and E8 raised, not yet reviewed (E1 done, E4 legacy). End of week 1: E3.
    assert [row["waiting_at_end"] for row in response.json()["queue"]] == [2, 1]


async def test_fleet_review_time_to_review_pools_hours_per_reviewed_bucket(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_reviews(db_session, operator, stops)

    response = await client.get(_REVIEW, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    week0, week1 = response.json()["time_to_review"]
    assert (week0["reviewed_count"], week0["median_hours"], week0["mean_hours"]) == (1, pytest.approx(48), pytest.approx(48))
    assert (week1["reviewed_count"], week1["median_hours"], week1["mean_hours"]) == (2, pytest.approx(180), pytest.approx(180))


async def test_fleet_review_outcomes_count_every_severity_but_never_legacy(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_reviews(db_session, operator, stops)

    response = await client.get(_REVIEW, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    assert [(row["outcome"], row["count"]) for row in response.json()["outcomes"]] == [
        ("no_action_required", 1),
        ("handled_externally", 0),
        ("evidence_verified", 1),
        ("data_discrepancy", 1),
        ("referred_for_follow_up", 1),
    ]
