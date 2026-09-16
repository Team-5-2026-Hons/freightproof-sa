"""Integration contract for GET /api/v1/analytics/fleet/evidence (fleet analytics spec §5.5).

Charts 5.1, 5.2 and 5.7 over one seeded fortnight (two whole past weeks, built from "now"). The
blockchain receipts chart (5.4) was removed in D25, so the response must not carry `receipts`:
  A  day 1, closed. Tracker: activation, loading, confirmation confirmed; departure mismatch;
     unloading unwitnessed; in_transit "confirmed" (must be ignored). Departure receipt pending,
     sign-off receipt failed. Receiver scanned the sign-off. Two rejected scans, one accepted.
  B  day 8, closed. Unloading overridden (out of the tracker, into overrides). No receiver scan.
  C  day 9, closed. Receiver scanned from the driver's own phone (same-phone flag).
  D  day 10, open, just created: open trips never count.
  E  day 11, open, departure overridden: open, so never counts either.
  F  3 days before the period, closed: none of it counts.
Plus another operator's closed trip, scan and rejected attempt, which must never count.
"""

from collections.abc import AsyncIterator
from datetime import date, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import AnchorStatus, HandoverTokenRejectionReason, PhaseStatus, PhaseType, TripStatus
from app.db.models.organisations import Precinct
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token
from tests.integration._fleet_seed import (
    SINGLE_LEG,
    Operator,
    add_receiver_confirmation,
    add_token_attempt,
    at_sast,
    headers,
    not_started,
    operator_from_seed,
    other_operator,
    replace_step,
    seed_trip,
    today_sast,
)

_EVIDENCE = "/api/v1/analytics/fleet/evidence"
_WEEKS_BACK = 4


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


async def _seed_fortnight(db: AsyncSession, operator: Operator, stops: list[Precinct]) -> None:
    steps_a = SINGLE_LEG
    for phase, verdict in (
        (PhaseType.ACTIVATION, True), (PhaseType.LOADING, True), (PhaseType.DEPARTURE, False),
        (PhaseType.IN_TRANSIT, True), (PhaseType.UNLOADING, None), (PhaseType.CONFIRMATION, True),
    ):
        steps_a = replace_step(steps_a, phase, geofence=verdict)
    steps_a = replace_step(steps_a, PhaseType.DEPARTURE, anchor_status=AnchorStatus.PENDING)
    steps_a = replace_step(steps_a, PhaseType.CONFIRMATION, anchor_status=AnchorStatus.FAILED)
    trip_a = await seed_trip(db, operator, stops=stops, start=at_sast(_day(1), 6), steps=steps_a)
    await add_receiver_confirmation(db, trip_a, confirmed_at=at_sast(_day(1), 15))
    for reason in (HandoverTokenRejectionReason.EXPIRED, HandoverTokenRejectionReason.WRONG_STOP, None):
        await add_token_attempt(db, trip_a.trip, attempted_at=at_sast(_day(2), 9), rejection_reason=reason)
    await add_token_attempt(db, trip_a.trip, attempted_at=at_sast(_day(-3), 9), rejection_reason=HandoverTokenRejectionReason.EXPIRED)

    overridden_unloading = replace_step(SINGLE_LEG, PhaseType.UNLOADING, status=PhaseStatus.OVERRIDDEN, geofence=True)
    await seed_trip(db, operator, stops=stops, start=at_sast(_day(8), 6), steps=overridden_unloading)
    trip_c = await seed_trip(db, operator, stops=stops, start=at_sast(_day(9), 6))
    await add_receiver_confirmation(db, trip_c, confirmed_at=at_sast(_day(9), 15), bearer_token_present=True)
    await seed_trip(db, operator, stops=stops, start=at_sast(_day(10), 6), status=TripStatus.ACTIVE, steps=not_started())
    overridden_departure = replace_step(not_started(), PhaseType.DEPARTURE, status=PhaseStatus.OVERRIDDEN, anchor_status=AnchorStatus.PENDING)
    await seed_trip(db, operator, stops=stops, start=at_sast(_day(11), 6), status=TripStatus.ACTIVE, steps=overridden_departure)
    await seed_trip(db, operator, stops=stops, start=at_sast(_day(-3), 6))

    other = await other_operator(db)
    stranger = await seed_trip(db, other, stops=stops, start=at_sast(_day(2), 6))
    await add_receiver_confirmation(db, stranger, confirmed_at=at_sast(_day(2), 15), bearer_token_present=True)
    await add_token_attempt(db, stranger.trip, attempted_at=at_sast(_day(2), 9), rejection_reason=HandoverTokenRejectionReason.UNKNOWN)


# ── Auth and 422 ─────────────────────────────────────────────────────────────


async def test_fleet_evidence_without_token_returns_403(client: AsyncClient) -> None:
    response = await client.get(_EVIDENCE, params=_params())

    assert response.status_code == 403


async def test_fleet_evidence_with_malformed_token_returns_401(client: AsyncClient) -> None:
    response = await client.get(_EVIDENCE, params=_params(), headers=auth_header("not-a-jwt"))

    assert response.status_code == 401


async def test_fleet_evidence_with_driver_token_returns_403(client: AsyncClient, operator: Operator) -> None:
    token = make_token(sub=str(operator.driver.id), role="driver", org_id=str(operator.org.id))

    response = await client.get(_EVIDENCE, params=_params(), headers=auth_header(token))

    assert response.status_code == 403


async def test_fleet_evidence_rejects_a_missing_grain(client: AsyncClient, operator: Operator) -> None:
    params = {key: value for key, value in _params().items() if key != "grain"}

    response = await client.get(_EVIDENCE, params=params, headers=headers(operator))

    assert response.status_code == 422


# ── 200 ──────────────────────────────────────────────────────────────────────


async def test_fleet_evidence_for_an_org_without_trips_is_empty_but_complete(
    client: AsyncClient, operator: Operator,
) -> None:
    response = await client.get(_EVIDENCE, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert [row["agreement_rate"] for row in body["tracker"]] == [None, None]
    assert [row["override_rate"] for row in body["overrides"]] == [None, None]
    assert "receipts" not in body
    assert [row["receiver_scan_rate"] for row in body["receiver_signoff"]] == [None, None]
    assert body["signoff_flags"] == {"same_phone_count": 0, "rejected_attempt_count": 0}


async def test_fleet_evidence_tracker_ignores_in_transit_and_overridden_steps(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_EVIDENCE, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    week0, week1 = response.json()["tracker"]
    assert (week0["confirmed_count"], week0["mismatch_count"], week0["unwitnessed_count"]) == (3, 1, 1)
    assert week0["agreement_rate"] == pytest.approx(0.75)
    # B: four stop steps with no reading (unloading overridden, so out); C: five.
    assert (week1["confirmed_count"], week1["mismatch_count"], week1["unwitnessed_count"]) == (0, 0, 9)
    assert week1["agreement_rate"] is None


async def test_fleet_evidence_override_share_is_over_every_closed_trip_step(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_EVIDENCE, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    week0, week1 = response.json()["overrides"]
    assert (week0["phase_count"], week0["override_count"], week0["override_rate"]) == (7, 0, 0.0)
    assert (week1["phase_count"], week1["override_count"]) == (14, 1)
    assert week1["override_rate"] == pytest.approx(1 / 14)


async def test_fleet_evidence_receiver_signoff_and_flags_stay_in_the_organisation(
    client: AsyncClient, db_session: AsyncSession, operator: Operator, stops: list[Precinct],
) -> None:
    await _seed_fortnight(db_session, operator, stops)

    response = await client.get(_EVIDENCE, params=_params(), headers=headers(operator))

    assert response.status_code == 200
    body = response.json()
    assert [(row["confirmation_count"], row["receiver_scan_count"]) for row in body["receiver_signoff"]] == [(1, 1), (2, 1)]
    assert body["receiver_signoff"][1]["receiver_scan_rate"] == pytest.approx(0.5)
    assert body["signoff_flags"] == {"same_phone_count": 1, "rejected_attempt_count": 2}
