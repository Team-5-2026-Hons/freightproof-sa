"""FP-290 Task 2: concurrent workers and sweeps, and edited evidence, on separate connections.

Separate module and separate connections for the reason test_exception_idempotency_concurrency
gives: the shared db_session is one transaction, so two sessions drawn from it can never race.
Everything here is committed, then deleted in teardown.
"""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest_asyncio
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, ExceptionType, SubjectType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import EvidenceAnchorEvent, ExceptionArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.evidence_anchors.execution import anchor_evidence_event
from app.orchestration.evidence_anchors.recovery import recover_evidence_anchor
from app.orchestration.exceptions.creation import raise_exception

from tests.integration._evidence_anchor_world import World, make_artifact, seed_world


async def _teardown(session: AsyncSession, world: World) -> None:
    trip = world.trip
    await session.execute(delete(EvidenceAnchorEvent).where(EvidenceAnchorEvent.trip_id == trip.id))
    await session.execute(delete(BlockchainReceipt).where(BlockchainReceipt.trip_id == trip.id))
    exception_ids = select(TripException.id).where(TripException.trip_id == trip.id)
    await session.execute(delete(ExceptionArtifact).where(ExceptionArtifact.exception_id.in_(exception_ids)))
    await session.execute(delete(TripException).where(TripException.trip_id == trip.id))
    await session.execute(delete(EvidenceArtifact).where(EvidenceArtifact.trip_id == trip.id))
    await session.execute(delete(Trip).where(Trip.id == trip.id))
    await session.execute(delete(Precinct).where(Precinct.id.in_([trip.origin_precinct_id, trip.destination_precinct_id])))
    await session.execute(delete(Vehicle).where(Vehicle.id == trip.horse_id))
    await session.execute(delete(Driver).where(Driver.id == world.driver.id))
    await session.execute(delete(User).where(User.id == world.user.id))
    await session.execute(delete(Organization).where(
        Organization.id.in_([world.org.id, trip.client_organization_id])))
    await session.commit()


@pytest_asyncio.fixture
async def committed(test_engine):
    """A committed critical report (with one photo) whose event is still pending."""
    async with AsyncSession(test_engine, expire_on_commit=False) as session:
        world = await seed_world(session)
        photo = await make_artifact(session, world.trip.id)
        report = await raise_exception(
            session, trip_id=world.trip.id, driver_id=world.driver.id,
            exception_type=ExceptionType.SEAL_BROKEN_IN_TRANSIT, description="Seal cut.",
            supporting_artifact_id=None, supporting_artifact_ids=[photo.id],
        )
        await session.commit()
    event_id = report.anchor_events[0].event_id
    try:
        yield world, report.id, event_id
    finally:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            await _teardown(session, world)


async def _worker(engine, event_id: uuid.UUID) -> bool:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        anchored = await anchor_evidence_event(session, event_id=event_id)
        await session.commit()
        return anchored


async def _receipts(engine, trip_id: uuid.UUID) -> list[BlockchainReceipt]:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        return list((await session.execute(
            select(BlockchainReceipt).where(BlockchainReceipt.trip_id == trip_id))).scalars().all())


async def _event(engine, event_id: uuid.UUID) -> EvidenceAnchorEvent:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        return (await session.execute(
            select(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id))).scalar_one()


async def test_two_workers_for_one_event_write_exactly_one_linked_receipt(test_engine, committed):
    world, _, event_id = committed

    results = await asyncio.gather(_worker(test_engine, event_id), _worker(test_engine, event_id))

    assert results == [True, True]
    receipts = await _receipts(test_engine, world.trip.id)
    event = await _event(test_engine, event_id)
    assert len(receipts) == 1
    assert event.receipt_id == receipts[0].id and event.anchor_status == AnchorStatus.ANCHORED


async def test_two_sweeps_for_one_debt_write_exactly_one_receipt(test_engine, committed):
    world, _, _ = committed

    async def sweep():
        async with AsyncSession(test_engine, expire_on_commit=False) as session, session.begin():
            return await recover_evidence_anchor(session, due_before=datetime.now(UTC))

    results = await asyncio.gather(sweep(), sweep())

    assert sorted(map(str, results)) == ["None", "True"]
    assert len(await _receipts(test_engine, world.trip.id)) == 1


async def test_edited_payload_json_is_never_anchored(test_engine, committed):
    world, _, event_id = committed
    original = await _event(test_engine, event_id)
    async with AsyncSession(test_engine) as session:
        await session.execute(update(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id).values(
            payload_json={**original.payload_json, "severity": "info"}))
        await session.commit()

    anchored = await _worker(test_engine, event_id)

    event = await _event(test_engine, event_id)
    assert anchored is False
    assert event.anchor_status == AnchorStatus.FAILED and event.receipt_id is None
    assert event.event_hash == original.event_hash
    assert await _receipts(test_engine, world.trip.id) == []


async def test_changed_source_is_never_re_baselined(test_engine, committed):
    world, exception_id, event_id = committed
    original = await _event(test_engine, event_id)
    async with AsyncSession(test_engine) as session:
        await session.execute(update(TripException).where(TripException.id == exception_id).values(
            description="Edited after the fact."))
        await session.commit()

    assert await _worker(test_engine, event_id) is False
    async with AsyncSession(test_engine) as session, session.begin():
        assert await recover_evidence_anchor(session, due_before=datetime.now(UTC)) is False

    event = await _event(test_engine, event_id)
    assert event.anchor_status == AnchorStatus.FAILED
    assert event.event_hash == original.event_hash
    assert await _receipts(test_engine, world.trip.id) == []


async def test_linked_receipt_of_the_wrong_kind_is_not_replaced(test_engine, committed):
    world, _, event_id = committed
    async with AsyncSession(test_engine) as session:
        wrong = BlockchainReceipt(
            id=uuid.uuid4(), trip_id=world.trip.id, subject_type=SubjectType.EVIDENCE_EVENT,
            subject_id=event_id, receipt_type=BlockchainReceiptType.EXCEPTION_REVIEWED,
            data_hash="0" * 64, payload_json={},
        )
        wrong_id = wrong.id
        session.add(wrong)
        await session.flush()
        await session.execute(update(EvidenceAnchorEvent).where(EvidenceAnchorEvent.id == event_id).values(
            receipt_id=wrong_id, anchor_status=AnchorStatus.ANCHORED))
        await session.commit()

    anchored = await _worker(test_engine, event_id)

    receipts = await _receipts(test_engine, world.trip.id)
    event = await _event(test_engine, event_id)
    assert anchored is False
    assert [r.id for r in receipts] == [wrong_id] and event.receipt_id == wrong_id


async def test_hedera_failure_commits_failed_and_keeps_the_source(test_engine, committed, monkeypatch):
    from unittest.mock import AsyncMock
    from app.core.exceptions import HederaServiceError
    world, exception_id, event_id = committed
    monkeypatch.setattr(
        "app.orchestration.evidence_anchors.execution.anchor_subject",
        AsyncMock(side_effect=HederaServiceError("down")))

    assert await _worker(test_engine, event_id) is False

    event = await _event(test_engine, event_id)
    assert event.anchor_status == AnchorStatus.FAILED and event.receipt_id is None
    async with AsyncSession(test_engine) as session:
        assert (await session.execute(select(func.count()).select_from(TripException).where(
            TripException.id == exception_id))).scalar_one() == 1
