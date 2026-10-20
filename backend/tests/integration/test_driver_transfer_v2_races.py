"""Independent-session v2 races; no shared-transaction approximation of locks."""
import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import IncomingDriverUnavailableError, SubstitutionNotPendingError, SubstitutionVersionChangedError
from app.db.models.driver_substitutions import DriverSubstitutionConfirmation, DriverSubstitutionRequest
from app.db.models.enums import TripStatus
from app.db.models.people import Driver
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.substitutions import service
from app.orchestration.substitutions.access import get_current_custody
from app.schemas import driver_substitutions as ds
from tests.integration._driver_substitution_world import SubWorld, add_trip
from tests.integration.test_driver_substitution_concurrency import sessionmaker as committed_sessions, world as committed_world
from tests.integration.test_driver_substitution_service import dispatcher, capture, driver_actor

sessionmaker = committed_sessions
world = committed_world


async def immediate_request(db: AsyncSession, w: SubWorld) -> uuid.UUID:
    pending = (await db.execute(select(DriverSubstitutionRequest).where(
        DriverSubstitutionRequest.trip_id == w.trip_id, DriverSubstitutionRequest.state == 'pending',
    ))).scalar_one()
    result = await service.replace_substitution(db, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
        payload=ds.ReplaceImmediateSubstitutionRequest(client_request_id=uuid.uuid4(), request_format='immediate_v2',
            incoming_driver_id=w.b, reason='Race fixture', expected_version=pending.version, replacement_reason='Adopt v2'))
    assert result.replacement_request_id is not None
    return result.replacement_request_id


@pytest.mark.parametrize('competing', ['duplicate', 'cancel', 'replace'])
async def test_v2_acceptance_races_leave_one_valid_terminal_result(
    sessionmaker: async_sessionmaker[AsyncSession], world: SubWorld, competing: str,
) -> None:
    async with sessionmaker() as db:
        request_id = await immediate_request(db, world)
        incoming_c = await db.get(Driver, world.c)
        assert incoming_c is not None
        incoming_c.license_expiry = datetime.now(UTC).date() + timedelta(days=30)
        await db.commit()
    body = capture(world, 1)
    ready = asyncio.Event()

    async def accept() -> ds.SubstitutionRequestRead:
        async with sessionmaker() as db:
            await ready.wait()
            result = await service.confirm_substitution(db, trip_id=world.trip_id, request_id=request_id,
                actor=await driver_actor(db, world.b), payload=body)
            await db.commit()
            return result

    async def other() -> ds.SubstitutionRequestRead:
        if competing == 'duplicate':
            return await accept()
        async with sessionmaker() as db:
            await ready.wait()
            if competing == 'cancel':
                result = await service.cancel_substitution(db, trip_id=world.trip_id, request_id=request_id,
                    actor=dispatcher(world), payload=ds.CancelSubstitutionRequest(
                        client_request_id=uuid.uuid4(), expected_version=1, reason='Cancel race'))
            else:
                result = await service.replace_substitution(db, trip_id=world.trip_id, request_id=request_id,
                    actor=dispatcher(world), payload=ds.ReplaceImmediateSubstitutionRequest(
                        client_request_id=uuid.uuid4(), expected_version=1, request_format='immediate_v2',
                        incoming_driver_id=world.c, reason='Replace race', replacement_reason='Change incoming'))
            await db.commit()
            return result

    tasks = [asyncio.create_task(accept()), asyncio.create_task(other())]
    ready.set()
    results = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 10)
    errors = [result for result in results if isinstance(result, BaseException)]
    assert all(isinstance(error, (SubstitutionNotPendingError, SubstitutionVersionChangedError)) for error in errors), errors
    assert len(errors) == (0 if competing == 'duplicate' else 1)
    async with sessionmaker() as db:
        request = await db.get(DriverSubstitutionRequest, request_id)
        assert request is not None
        count = await db.scalar(select(func.count()).select_from(DriverSubstitution).where(DriverSubstitution.trip_id == world.trip_id))
        assert request.state in ('completed', 'cancelled')
        assert count == (1 if request.state == 'completed' else 0)
        assert await db.scalar(select(func.count()).select_from(DriverSubstitutionConfirmation).where(
            DriverSubstitutionConfirmation.request_id == request_id)) == count
        trip = await db.get(Trip, world.trip_id)
        assert trip is not None
        custody = await get_current_custody(db, trip=trip)
        assert custody.driver_id == (world.b if count else world.a)


async def test_immediate_and_legacy_requests_cannot_reserve_the_same_incoming_driver(
    sessionmaker: async_sessionmaker[AsyncSession], world: SubWorld,
) -> None:
    now = datetime.now(UTC)
    async with sessionmaker() as db:
        old = (await db.execute(select(DriverSubstitutionRequest).where(
            DriverSubstitutionRequest.trip_id == world.trip_id, DriverSubstitutionRequest.state == 'pending',
        ))).scalar_one()
        await service.cancel_substitution(db, trip_id=world.trip_id, request_id=old.id, actor=dispatcher(world),
            payload=ds.CancelSubstitutionRequest(client_request_id=uuid.uuid4(), expected_version=old.version, reason='Prepare race'))
        second_id, _ = await add_trip(db, world, driver_id=world.c, status=TripStatus.ACTIVE,
            departure=now, arrival=now + timedelta(hours=8))
        await db.commit()
    ready = asyncio.Event()

    async def arrange(immediate: bool) -> ds.SubstitutionRequestRead:
        async with sessionmaker() as db:
            await ready.wait()
            common = {'client_request_id': uuid.uuid4(), 'incoming_driver_id': world.b, 'reason': 'Reservation race'}
            payload = ds.ArrangeImmediateSubstitutionRequest(**common, request_format='immediate_v2') if immediate else ds.ArrangeSubstitutionRequest(
                **common, exchange=ds.ExchangePoint(label='Legacy depot', latitude=-30, longitude=25),
                expected_at=now + timedelta(hours=2), is_planned=True)
            result = await service.arrange_substitution(db, trip_id=world.trip_id if immediate else second_id,
                actor=dispatcher(world), payload=payload)
            await db.commit()
            return result

    tasks = [asyncio.create_task(arrange(True)), asyncio.create_task(arrange(False))]
    ready.set()
    results = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 10)
    assert sum(isinstance(result, IncomingDriverUnavailableError) for result in results) == 1, results
    assert sum(isinstance(result, ds.SubstitutionRequestRead) for result in results) == 1
