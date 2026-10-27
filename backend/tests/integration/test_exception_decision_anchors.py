"""FP-290 Task 3: every new actual review of an exception freezes its own anchor event.

Single, batch and dispatcher-authored reviews each get exactly one `exception_reviewed`
event per newly reviewed row; replays, conflicts and refused batches get none. A review of a
historical critical exception creates its review event only — no raise event is invented.
"""

import uuid
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.blockchain.anchor_service import compute_payload_hash
from app.core.exceptions import BatchReviewRejectedError, ExceptionAlreadyReviewedError
from app.db.models.enums import (
    BlockchainReceiptType, DispatcherReviewOutcome, ExceptionContactMethod, ExceptionReviewStatus,
    ExceptionSeverity, ExceptionSource, ExceptionType, SubjectType, VerifyStatus,
)
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.people import User
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors import canonical
from app.orchestration.evidence_anchors.execution import anchor_evidence_event
from app.orchestration.exceptions.creation import raise_exception
from app.orchestration.exceptions.review import review_exception, review_exceptions_batch
from app.orchestration.verification.service import verify_subject
from app.tasks.evidence_anchors import anchor_event_task

from tests.integration._evidence_anchor_world import World, seed_world

_OUTCOME = DispatcherReviewOutcome.EVIDENCE_VERIFIED


@pytest_asyncio.fixture
async def world(db_session) -> World:
    return await seed_world(db_session)


async def _second_dispatcher(db, world: World) -> uuid.UUID:
    other = User(id=uuid.uuid4(), organization_id=world.org_id, email=f"o-{uuid.uuid4()}@t.co.za", full_name="O")
    db.add(other)
    await db.flush()
    return other.id


async def _report(db, world: World, kind: ExceptionType = ExceptionType.CARGO_DAMAGE) -> uuid.UUID:
    return (await raise_exception(
        db, trip_id=world.trip_id, driver_id=world.driver_id, exception_type=kind,
        description=f"Report {uuid.uuid4()}", supporting_artifact_id=None,
    )).id


async def _events(db, exception_id: uuid.UUID | None = None) -> list[EvidenceAnchorEvent]:
    query = select(EvidenceAnchorEvent).order_by(EvidenceAnchorEvent.occurred_at, EvidenceAnchorEvent.id)
    if exception_id is not None:
        query = query.where(EvidenceAnchorEvent.exception_id == exception_id)
    return list((await db.execute(query)).scalars().all())


async def _review(db, world: World, exception_id: uuid.UUID, *, user_id: uuid.UUID | None = None):
    return await review_exception(
        db, exception_id=exception_id, user_id=user_id or world.user.id, organization_id=world.org_id,
        review_note="Called the driver.", review_outcome=_OUTCOME, contact_method=ExceptionContactMethod.PHONE,
    )


async def test_single_review_freezes_one_review_event(db_session, world):
    exception_id = await _report(db_session, world)

    read = await _review(db_session, world, exception_id)

    [event] = await _events(db_session, exception_id)
    assert event.receipt_type == BlockchainReceiptType.EXCEPTION_REVIEWED
    assert event.event_hash == compute_payload_hash(event.payload_json)
    assert event.payload_json["reviewed_by_sha256"] == canonical.actor_sha256(world.user.id)
    assert event.payload_json["review_outcome"] == "evidence_verified"
    assert event.payload_json["contact_method"] == "phone"
    assert event.payload_json["authored_statement_sha256"] is None
    assert event.occurred_at == read.reviewed_at
    assert [e.event_id for e in read.anchor_events] == [event.id]


async def test_reviewing_a_critical_report_adds_a_review_event_beside_its_raise_event(db_session, world):
    exception_id = await _report(db_session, world, ExceptionType.PANIC_BUTTON)

    await _review(db_session, world, exception_id)

    kinds = sorted(str(e.receipt_type.value if hasattr(e.receipt_type, "value") else e.receipt_type)
                   for e in await _events(db_session, exception_id))
    assert kinds == ["exception_raised", "exception_reviewed"]


async def test_reviewing_a_historical_critical_exception_does_not_invent_a_raise_event(db_session, world):
    legacy = TripException(
        trip_id=world.trip_id, exception_type=ExceptionType.PANIC_BUTTON, source=ExceptionSource.DRIVER,
        severity=ExceptionSeverity.CRITICAL, description="Old report", review_status=ExceptionReviewStatus.NEEDS_REVIEW,
    )
    db_session.add(legacy)
    await db_session.flush()
    legacy_id = legacy.id

    await _review(db_session, world, legacy_id)

    [event] = await _events(db_session, legacy_id)
    assert event.receipt_type == BlockchainReceiptType.EXCEPTION_REVIEWED


async def test_same_reviewer_replay_creates_no_second_event(db_session, world):
    exception_id = await _report(db_session, world)
    await _review(db_session, world, exception_id)

    await _review(db_session, world, exception_id)

    assert len(await _events(db_session, exception_id)) == 1


async def test_conflicting_reviewer_is_refused_and_creates_no_event(db_session, world):
    exception_id = await _report(db_session, world)
    await _review(db_session, world, exception_id)
    other = await _second_dispatcher(db_session, world)

    with pytest.raises(ExceptionAlreadyReviewedError):
        await _review(db_session, world, exception_id, user_id=other)

    events = await _events(db_session, exception_id)
    assert len(events) == 1
    assert events[0].payload_json["reviewed_by_sha256"] == canonical.actor_sha256(world.user.id)


async def test_review_event_is_dispatched_only_after_commit(db_session, world):
    exception_id = await _report(db_session, world)
    anchor_event_task.delay.reset_mock()

    await _review(db_session, world, exception_id)
    anchor_event_task.delay.assert_not_called()
    await db_session.commit()
    from app.orchestration.evidence_anchors import dispatch
    import asyncio
    while dispatch._BACKGROUND_EVIDENCE_TASKS:
        await asyncio.gather(*tuple(dispatch._BACKGROUND_EVIDENCE_TASKS))

    [event] = await _events(db_session, exception_id)
    anchor_event_task.delay.assert_called_once_with(str(event.id))


async def test_review_event_anchors_and_verifies_then_detects_an_edited_note(db_session, world):
    exception_id = await _report(db_session, world)
    await _review(db_session, world, exception_id)
    [event] = await _events(db_session, exception_id)
    event_id = event.id
    assert await anchor_evidence_event(db_session, event_id=event_id) is True
    mirror = MagicMock()
    mirror.verify_hash.return_value = True

    ok = await verify_subject(
        db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event_id, hedera_service=mirror)
    await db_session.execute(update(TripException).where(TripException.id == exception_id).values(
        review_note="Rewritten later."))
    db_session.expire_all()
    edited = await verify_subject(
        db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event_id, hedera_service=mirror)

    assert ok.status == VerifyStatus.VERIFIED
    assert edited.status == VerifyStatus.DB_MISMATCH


async def test_raise_and_review_events_are_distinct_and_each_verifies(db_session, world):
    exception_id = await _report(db_session, world, ExceptionType.PANIC_BUTTON)
    await _review(db_session, world, exception_id)
    mirror = MagicMock()
    mirror.verify_hash.return_value = True

    results = []
    for event in await _events(db_session, exception_id):
        event_id = event.id
        await anchor_evidence_event(db_session, event_id=event_id)
        results.append((await verify_subject(
            db_session, subject_type=SubjectType.EVIDENCE_EVENT, subject_id=event_id, hedera_service=mirror,
        )).status)

    assert results == [VerifyStatus.VERIFIED, VerifyStatus.VERIFIED]


async def _batch(db, world: World, ids: list[uuid.UUID], user_id: uuid.UUID | None = None):
    return await review_exceptions_batch(
        db, trip_id=world.trip_id, exception_ids=ids, user_id=user_id or world.user.id,
        organization_id=world.org_id, review_note="Routine.", review_outcome=_OUTCOME, contact_method=None,
    )


async def test_batch_creates_one_event_per_newly_reviewed_row(db_session, world):
    ids = [await _report(db_session, world) for _ in range(3)]

    reads = await _batch(db_session, world, ids)

    events = await _events(db_session)
    assert sorted(e.exception_id for e in events) == sorted(ids)
    assert len({e.id for e in events}) == 3
    assert all(e.receipt_type == BlockchainReceiptType.EXCEPTION_REVIEWED for e in events)
    assert all(len(r.anchor_events) == 1 for r in reads)


async def test_mixed_batch_skips_rows_this_user_already_reviewed(db_session, world):
    first, second, third = [await _report(db_session, world) for _ in range(3)]
    await _review(db_session, world, first)
    before = {e.exception_id: e.id for e in await _events(db_session)}

    await _batch(db_session, world, [first, second, third])

    after = {e.exception_id: e.id for e in await _events(db_session)}
    assert set(after) == {first, second, third}
    assert after[first] == before[first]


async def test_replayed_batch_creates_no_new_events(db_session, world):
    ids = [await _report(db_session, world) for _ in range(2)]
    await _batch(db_session, world, ids)
    before = len(await _events(db_session))

    await _batch(db_session, world, ids)

    assert len(await _events(db_session)) == before


async def test_batch_is_all_or_nothing(db_session, world):
    routine = await _report(db_session, world)
    critical = await _report(db_session, world, ExceptionType.PANIC_BUTTON)
    raised_only = len(await _events(db_session))

    with pytest.raises(BatchReviewRejectedError):
        await _batch(db_session, world, [routine, critical])

    assert len(await _events(db_session)) == raised_only
    row = await db_session.get(TripException, routine)
    assert row.review_status == ExceptionReviewStatus.NEEDS_REVIEW


async def test_batch_conflict_with_a_colleagues_review_creates_nothing(db_session, world):
    mine, theirs = await _report(db_session, world), await _report(db_session, world)
    other = await _second_dispatcher(db_session, world)
    await _review(db_session, world, theirs, user_id=other)
    before = len(await _events(db_session))

    with pytest.raises(ExceptionAlreadyReviewedError):
        await _batch(db_session, world, [mine, theirs])

    assert len(await _events(db_session)) == before
