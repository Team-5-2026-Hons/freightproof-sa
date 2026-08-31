"""Concurrency proofs for the session stamps (app/auth/sessions.py), both halves.

A dispatcher signs in and the browser immediately fires several authenticated
requests at once — the trip list, the precinct list, the blockchain check, the SSE
stream. Every one of them runs get_current_dispatcher, and on a brand-new session
every one of them finds no user_sessions row and tries to create it. Exactly one
INSERT can win; the rest must recover, not 500.

Why this file does not use the `db_session` fixture: see the same note in
test_creation_concurrency.py. Sessions built on that fixture share one transaction,
so there is no cross-transaction unique violation to observe and the test would pass
against the unfixed code.
"""

import asyncio
import time
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.auth.sessions import (
    SESSION_SUPERSEDED_DETAIL,
    enforce_single_device,
    enforce_user_idle_timeout,
)
from app.db.models.enums import OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.db.models.sessions import DriverSession, UserSession

# One page load fans out to more than two calls, and the failure only appears for the
# racers that lose — three makes the loser side of the race plural, as it is in the app.
_RACERS = 3


@pytest_asyncio.fixture
async def dispatcher(test_engine):
    """A committed dispatcher for the racing sessions to authenticate as.

    Committed rather than held open: the racers run on their own connections and
    would not see an uncommitted row. Teardown removes exactly what was created.
    """
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:8]

    org = Organization(
        id=uuid.uuid4(), name=f"Session Op {suffix}", org_type=OrganizationType.OPERATOR
    )
    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"dispatcher-{suffix}@test.co.za", full_name="Dispatcher",
    )
    async with sessionmaker() as db:
        db.add(org)
        await db.flush()
        db.add(user)
        await db.commit()

    yield user

    async with sessionmaker() as db:
        await db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        await db.execute(delete(User).where(User.id == user.id))
        await db.execute(delete(Organization).where(Organization.id == org.id))
        await db.commit()


@pytest.mark.asyncio
async def test_parallel_first_requests_on_a_new_session_all_succeed(test_engine, dispatcher) -> None:
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    barrier = asyncio.Barrier(_RACERS)
    # One session_id, as it would be: every request from the page carries the same token.
    payload = {
        "session_id": str(uuid.uuid4()),
        "iat": int(datetime.now(UTC).timestamp()),
    }

    async def racer() -> None:
        async with sessionmaker() as db:
            # Released together, immediately before the SELECT that finds no row.
            await barrier.wait()
            await enforce_user_idle_timeout(db, user_id=dispatcher.id, payload=payload)
            await db.commit()

    outcomes = await asyncio.gather(*(racer() for _ in range(_RACERS)), return_exceptions=True)

    failures = [o for o in outcomes if isinstance(o, BaseException)]
    assert failures == [], f"{len(failures)} of {_RACERS} parallel requests failed: {failures!r}"

    async with sessionmaker() as db:
        rows = (await db.execute(
            select(UserSession).where(UserSession.user_id == dispatcher.id)
        )).scalars().all()
    assert len(rows) == 1


# How long the "slow endpoint" holds its request open. Comfortably longer than a stamp
# (~0.05s locally) so the assertion below can tell blocking from ordinary latency without
# being a stopwatch race, and short enough not to drag the suite out.
_SLOW_REQUEST_SECONDS = 3.0

# The line between "made its own progress" and "waited for the slow request". Set at a
# third of the slow request rather than at a stamp's real cost, so ordinary jitter or a
# loaded CI box cannot fail it — a regression parks the fast requests at the full
# _SLOW_REQUEST_SECONDS, which is nowhere near this.
_BLOCKED_THRESHOLD_SECONDS = _SLOW_REQUEST_SECONDS / 3


@pytest.mark.asyncio
async def test_a_slow_request_does_not_stall_its_siblings(test_engine, dispatcher) -> None:
    """One slow endpoint must not hold the session row hostage.

    Every request from one dispatcher stamps the SAME user_sessions row. Left inside the
    request's own transaction, that stamp holds a row lock until the request finishes, so
    a slow endpoint (a Hedera mirror lookup) makes every sibling request queue behind it —
    and the dispatcher's fetch timeout fires first, which is what surfaced in the UI as
    "Fetch is aborted" on every panel of the page at once.
    """
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    barrier = asyncio.Barrier(_RACERS)
    payload = {
        "session_id": str(uuid.uuid4()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    stamp_durations: dict[str, float] = {}

    async def racer(name: str, slow: bool) -> None:
        async with sessionmaker() as db:
            await barrier.wait()
            started = time.perf_counter()
            await enforce_user_idle_timeout(db, user_id=dispatcher.id, payload=payload)
            stamp_durations[name] = time.perf_counter() - started
            if slow:
                # Stands in for an endpoint that works for a long time after authenticating.
                await asyncio.sleep(_SLOW_REQUEST_SECONDS)
            await db.commit()

    await asyncio.gather(
        racer("slow", slow=True),
        racer("fast-a", slow=False),
        racer("fast-b", slow=False),
    )

    stalled = {n: d for n, d in stamp_durations.items() if d > _BLOCKED_THRESHOLD_SECONDS}
    assert stalled == {}, f"requests blocked on the session row: {stalled}"


# ── Driver ───────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def driver(test_engine):
    """A committed driver, on the same terms as the dispatcher fixture above."""
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:8]

    org = Organization(
        id=uuid.uuid4(), name=f"Session Op {suffix}", org_type=OrganizationType.OPERATOR
    )
    subject = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number=f"80010150{suffix[:5]}", phone_number=f"+2782{suffix[:7]}",
        license_number=f"DRV-{suffix}",
    )
    async with sessionmaker() as db:
        db.add(org)
        await db.flush()
        db.add(subject)
        await db.commit()

    yield subject

    async with sessionmaker() as db:
        await db.execute(delete(DriverSession).where(DriverSession.driver_id == subject.id))
        await db.execute(delete(Driver).where(Driver.id == subject.id))
        await db.execute(delete(Organization).where(Organization.id == org.id))
        await db.commit()


@pytest.mark.asyncio
async def test_parallel_first_requests_from_one_handset_all_succeed(test_engine, driver) -> None:
    """The driver-side twin of the dispatcher race: driver_sessions is keyed on
    driver_id, so a fresh login's parallel requests all try to insert the same row."""
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    barrier = asyncio.Barrier(_RACERS)
    payload = {
        "session_id": str(uuid.uuid4()),
        "iat": int(datetime.now(UTC).timestamp()),
    }

    async def racer() -> None:
        async with sessionmaker() as db:
            await barrier.wait()
            await enforce_single_device(db, driver_id=driver.id, payload=payload)
            await db.commit()

    outcomes = await asyncio.gather(*(racer() for _ in range(_RACERS)), return_exceptions=True)

    failures = [o for o in outcomes if isinstance(o, BaseException)]
    assert failures == [], f"{len(failures)} of {_RACERS} parallel requests failed: {failures!r}"

    async with sessionmaker() as db:
        rows = (await db.execute(
            select(DriverSession).where(DriverSession.driver_id == driver.id)
        )).scalars().all()
    assert len(rows) == 1
    assert rows[0].session_id == payload["session_id"]


@pytest.mark.asyncio
async def test_the_older_handset_still_loses_when_both_arrive_at_once(test_engine, driver) -> None:
    """Newest login wins, even when the two devices race for an unclaimed account.

    The rule cannot live in the read alone: both handsets read "no row", so whichever
    reaches the write second is the one that has to be refused, and only the write knows
    which that was. Here the old handset is deliberately given the later start.
    """
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    barrier = asyncio.Barrier(2)
    now = datetime.now(UTC)
    new_handset = {"session_id": str(uuid.uuid4()), "iat": int(now.timestamp())}
    old_handset = {"session_id": str(uuid.uuid4()), "iat": int(now.timestamp()) - 60}

    async def racer(payload: dict) -> None:
        async with sessionmaker() as db:
            await barrier.wait()
            await enforce_single_device(db, driver_id=driver.id, payload=payload)
            await db.commit()

    outcomes = await asyncio.gather(
        racer(new_handset), racer(old_handset), return_exceptions=True,
    )

    # The newer handset must never be the one that loses — that is the rule, and it does
    # not depend on which of the two reached Postgres first.
    assert outcomes[0] is None, f"the newer handset was refused: {outcomes[0]!r}"
    # The old handset either arrives second and is refused, or arrives first, claims the
    # row and is then superseded by the newer one. Both are correct, and which one happens
    # depends on arrival order — so this pins the part that is invariant: if it was
    # refused at all, it was refused as superseded, never with a database error.
    if outcomes[1] is not None:
        assert isinstance(outcomes[1], HTTPException), f"expected a refusal, got {outcomes[1]!r}"
        assert outcomes[1].detail == SESSION_SUPERSEDED_DETAIL

    # The invariant that holds either way: the newer handset ends up owning the account.

    async with sessionmaker() as db:
        row = (await db.execute(
            select(DriverSession).where(DriverSession.driver_id == driver.id)
        )).scalar_one()
    assert row.session_id == new_handset["session_id"]


@pytest.mark.asyncio
async def test_a_slow_driver_request_does_not_stall_its_siblings(test_engine, driver) -> None:
    """The driver-side twin of the stall above — a photo upload or an anchor is exactly
    the kind of slow request that would otherwise hold the handset's session row."""
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    barrier = asyncio.Barrier(_RACERS)
    payload = {
        "session_id": str(uuid.uuid4()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    stamp_durations: dict[str, float] = {}

    async def racer(name: str, slow: bool) -> None:
        async with sessionmaker() as db:
            await barrier.wait()
            started = time.perf_counter()
            await enforce_single_device(db, driver_id=driver.id, payload=payload)
            stamp_durations[name] = time.perf_counter() - started
            if slow:
                await asyncio.sleep(_SLOW_REQUEST_SECONDS)
            await db.commit()

    await asyncio.gather(
        racer("slow", slow=True), racer("fast-a", slow=False), racer("fast-b", slow=False),
    )

    stalled = {n: d for n, d in stamp_durations.items() if d > _BLOCKED_THRESHOLD_SECONDS}
    assert stalled == {}, f"requests blocked on the session row: {stalled}"
