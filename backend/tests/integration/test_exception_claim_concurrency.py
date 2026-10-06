"""B5 — two dispatchers claiming the same exception in the same instant.

The sibling of test_exception_review_concurrency.py, which races review_exception.
claim_exception and release_exception take the same row lock (_lock_for_review), but only
review was ever raced, so a refactor of the lock helper could break claiming while every
existing test stayed green: the sequential claim tests in test_exception_claims.py prove
the 409 branch is reachable and nothing about simultaneity.

Same constraints as that module: two independent connections and real commits, because
the shared `db_session` fixture puts every session in one transaction where row locks
can never contend. It reuses that module's seed and teardown so there is one definition
of "an open exception with two dispatchers".
"""

import asyncio
import uuid

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExceptionClaimedByColleagueError
from app.db.models.transit import TripException
from app.orchestration.exception_service import claim_exception
from tests.integration.test_exception_review_concurrency import _seed, _teardown

_CLAIMED = 200
_REFUSED = 409


@pytest_asyncio.fixture
async def seeded(test_engine):
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        ids = await _seed(session)
    try:
        yield ids
    finally:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            await _teardown(session, ids)


async def test_simultaneous_claims_leave_exactly_one_claimer(test_engine, seeded):
    """Both dispatchers press Claim at once, neither asking to take over.

    Without the row lock both read an unclaimed row, both pass the colleague check, and
    both are told they hold it while the second write silently replaces the first. With it,
    the loser re-reads after the winner commits, sees a colleague's claim and gets a 409.
    """

    async def attempt(user_id: uuid.UUID) -> tuple[uuid.UUID, int]:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            try:
                await claim_exception(
                    session, exception_id=seeded["exception_id"], user_id=user_id,
                    organization_id=seeded["org_id"], take_over=False,
                )
            except ExceptionClaimedByColleagueError:
                await session.rollback()
                return user_id, _REFUSED
            await session.commit()
            return user_id, _CLAIMED

    outcomes = await asyncio.gather(attempt(seeded["first_id"]), attempt(seeded["second_id"]))

    assert sorted(status for _user_id, status in outcomes) == [_CLAIMED, _REFUSED]
    winner = next(user_id for user_id, status in outcomes if status == _CLAIMED)
    # Asserted separately: a lock that serialised the writes but still let the loser
    # overwrite would pass the count above while recording the wrong claimer.
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        stored = await session.get(TripException, seeded["exception_id"])
    assert stored.claimed_by_user_id == winner
    assert stored.claimed_at is not None
