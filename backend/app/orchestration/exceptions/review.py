"""Dispatcher actions on an existing exception: review, claim, release and batch review.

Each one takes a row lock on the exception (FOR UPDATE) before deciding, so two dispatchers
cannot both act on the same row.
"""

import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BatchReviewRejectedError,
    ExceptionAlreadyReviewedError,
    ExceptionClaimedByColleagueError,
    ExceptionNotOpenError,
    ResourceNotFoundError,
)
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    DispatcherReviewOutcome,
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
)
from app.db.models.trips import Trip
from app.db.models.transit import TripException
from app.orchestration.evidence_anchors.reads import build_exception_read
from app.orchestration.evidence_anchors.recording import anchor_review
from app.orchestration.exceptions.review_identity import with_reviewer_names
from app.schemas.transit import TripExceptionRead

logger = logging.getLogger(__name__)


async def _flush_and_anchor(db: AsyncSession, exc: TripException) -> None:
    """Persist a NEW review, then freeze its anchor event in the same transaction
    (all-or-nothing) and queue it for after the outer commit. A replayed review never
    reaches this."""
    await db.flush()
    await db.refresh(exc)
    await anchor_review(db, exception=exc)


async def _read_with_anchors(db: AsyncSession, exc: TripException, trip: Trip) -> TripExceptionRead:
    """Serialise an exception with its trip's reference, its photos and its anchor events.

    The trip comes from the org-scoping join callers already perform, so the reference costs
    no query. Without it every exception row on the dispatcher's queue would say only which
    UUID it belonged to, and both screens would fetch the whole trip list to resolve it.
    """
    return (await build_exception_read(db, exc)).model_copy(update={"trip_reference": trip.trip_reference})


async def _lock_for_review(
    db: AsyncSession, *, exception_id: uuid.UUID, organization_id: uuid.UUID,
) -> tuple[TripException, Trip]:
    """Load an org-scoped exception and its trip, holding a row lock on the exception.

    Shared by review, claim and release: all three decide based on the current claim, so
    all three must hold the row.

    Joined rather than fetched separately: the org check and the load are one question
    ("is there such an exception that this dispatcher may act on"), and splitting them
    invites a later edit that answers only half of it.
    """
    row = (await db.execute(
        select(TripException, Trip)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            TripException.id == exception_id,
            Trip.operator_organization_id == organization_id,
        )
        .with_for_update(of=TripException)
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("TripException", str(exception_id))
    return row[0], row[1]


async def _read_with_names(db: AsyncSession, exc: TripException, trip: Trip) -> TripExceptionRead:
    """Dispatcher-facing read. raise_exception (driver-facing) builds its own read
    and gets no names by design."""
    [read] = await with_reviewer_names(
        db, organization_id=trip.operator_organization_id,
        reads=[await _read_with_anchors(db, exc, trip)],
    )
    return read


def _enqueue_claim_changed(db: AsyncSession, trip: Trip, exc: TripException) -> None:
    enqueue_event(db, trip.operator_organization_id, TripEvent(
        id=exc.trip_id, kind=RealtimeKind.EXCEPTION_CLAIMED,
        severity=event_severity(ExceptionSeverity.INFO),
    ))


async def review_exception(
    db: AsyncSession,
    *,
    exception_id: uuid.UUID,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    review_note: str,
    review_outcome: DispatcherReviewOutcome,
    contact_method: ExceptionContactMethod | None,
    take_over: bool = False,
) -> TripExceptionRead:
    """Record a dispatcher's immutable assessment of an exception.

    Reviewing is evidence handling, not trip lifecycle control. Active, closed and
    cancelled trips are all reviewable, and this function never changes Trip.status or
    any PhaseEvent.status. The outcome records what the dispatcher concluded; a nullable
    contact method records that evidence alone settled the assessment.

    **The server owns the reviewer and the clock.** `reviewed_by_user_id` comes from the
    token and `reviewed_at` from this process, never from the request body.

    Org scoping is authorisation, not a filter: the join to Trip means a dispatcher
    cannot review another operator's exception by guessing a UUID. A miss raises
    ResourceNotFoundError (→ 404) rather than a 403, because a 403 confirms the row
    exists to someone with no right to know it.

    The FIRST review is the evidence, always — overwriting it with a second assessment
    would rewrite the record of who established what, and when. What happens to the
    second call depends on WHO makes it:

    * **Same dispatcher** — idempotent. A double-tap and a replayed request both carry
      the same account, so the stored row comes back unchanged and nothing is lost.
    * **A different dispatcher** — ``ExceptionAlreadyReviewedError`` (→ 409). Their note,
      outcome and contact method are being discarded, and they may have established
      something the first reviewer did not. Returning 200 with a colleague's note would
      tell them their account was recorded when it was not.

    A row whose ``reviewed_by_user_id`` is NULL (reviewed before that column was
    captured) counts as a different dispatcher: we cannot prove otherwise.

    Soft claim (FP-280): reviewing auto-claims an unclaimed row for the reviewer in the
    same locked transaction. ``take_over=True`` takes a colleague's claim and reviews in
    one step; without it, a colleague's claim is a 409 — the page was loaded before the
    claim, and the reviewer must see it before overriding it.

    Raises:
        ResourceNotFoundError: no such exception in this organisation.
        ExceptionAlreadyReviewedError: another dispatcher reviewed it first.
        ExceptionClaimedByColleagueError: a colleague holds the claim and take_over is False.
    """
    exc, trip = await _lock_for_review(db, exception_id=exception_id, organization_id=organization_id)

    if exc.review_status == ExceptionReviewStatus.REVIEWED:
        if exc.reviewed_by_user_id == user_id:
            logger.info(
                "Review replayed by the same user: exception=%s org=%s",
                exception_id, organization_id,
            )
            return await _read_with_names(db, exc, trip)
        logger.info(
            "Review conflicted, already reviewed by another user: exception=%s org=%s "
            "first_reviewer=%s caller=%s",
            exception_id, organization_id, exc.reviewed_by_user_id, user_id,
        )
        raise ExceptionAlreadyReviewedError(str(exception_id))

    previous_claimer = exc.claimed_by_user_id
    if previous_claimer is not None and previous_claimer != user_id and not take_over:
        raise ExceptionClaimedByColleagueError(str(exception_id))
    now = datetime.now(UTC)
    if previous_claimer != user_id:
        exc.claimed_by_user_id = user_id
        exc.claimed_at = now
        if previous_claimer is not None:
            logger.info(
                "Exception taken over at review: exception=%s from=%s by=%s",
                exception_id, previous_claimer, user_id,
            )

    exc.review_status = ExceptionReviewStatus.REVIEWED
    exc.review_outcome = ExceptionReviewOutcome(review_outcome.value)
    exc.reviewed_by_user_id = user_id
    exc.reviewed_at = now
    exc.review_note = review_note
    exc.contact_method = contact_method
    await _flush_and_anchor(db, exc)

    logger.info(
        "Exception reviewed: exception=%s trip=%s by=%s outcome=%s contact=%s",
        exception_id, exc.trip_id, user_id, review_outcome.value,
        contact_method.value if contact_method is not None else None,
    )

    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=exc.trip_id, kind=RealtimeKind.EXCEPTION_REVIEWED,
            severity=event_severity(ExceptionSeverity.INFO),
        ),
    )

    return await _read_with_names(db, exc, trip)


async def claim_exception(
    db: AsyncSession, *, exception_id: uuid.UUID, user_id: uuid.UUID,
    organization_id: uuid.UUID, take_over: bool,
) -> TripExceptionRead:
    """Record that this dispatcher is working an unreviewed exception.

    Soft claim: anyone may take over, but only by saying so — a colleague's claim is
    a 409 unless take_over is set, so a stale page never replaces a claim it didn't
    show. A take-over is logged with both parties so the handover is traceable.
    Re-claiming your own claim is idempotent (no write, no event). A reviewed exception
    cannot be claimed: its claimer is part of the record by then.

    Raises:
        ResourceNotFoundError: no such exception in this organisation (-> 404).
        ExceptionNotOpenError: already reviewed (-> 409).
        ExceptionClaimedByColleagueError: a colleague holds it and take_over is False (-> 409).
    """
    exc, trip = await _lock_for_review(db, exception_id=exception_id, organization_id=organization_id)
    if exc.review_status == ExceptionReviewStatus.REVIEWED:
        raise ExceptionNotOpenError(str(exception_id))
    if exc.claimed_by_user_id == user_id:
        return await _read_with_names(db, exc, trip)
    previous = exc.claimed_by_user_id
    if previous is not None and not take_over:
        raise ExceptionClaimedByColleagueError(str(exception_id))

    exc.claimed_by_user_id = user_id
    exc.claimed_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(exc)
    logger.info(
        "Exception claimed: exception=%s trip=%s by=%s taken_over_from=%s",
        exception_id, exc.trip_id, user_id, previous,
    )
    _enqueue_claim_changed(db, trip, exc)
    return await _read_with_names(db, exc, trip)


async def release_exception(
    db: AsyncSession, *, exception_id: uuid.UUID, user_id: uuid.UUID, organization_id: uuid.UUID,
) -> TripExceptionRead:
    """Give an unreviewed exception back to the inbox. Only the claimer may release;
    anyone else takes over instead, so a release never silently drops a colleague's
    claim. Releasing an unclaimed row is a no-op, so a double-tap is harmless.

    Raises:
        ResourceNotFoundError: no such exception in this organisation (-> 404).
        ExceptionNotOpenError: already reviewed (-> 409).
        ExceptionClaimedByColleagueError: a colleague holds it (-> 409).
    """
    exc, trip = await _lock_for_review(db, exception_id=exception_id, organization_id=organization_id)
    if exc.review_status == ExceptionReviewStatus.REVIEWED:
        raise ExceptionNotOpenError(str(exception_id))
    if exc.claimed_by_user_id is None:
        return await _read_with_names(db, exc, trip)
    if exc.claimed_by_user_id != user_id:
        raise ExceptionClaimedByColleagueError(str(exception_id))

    exc.claimed_by_user_id = None
    exc.claimed_at = None
    await db.flush()
    await db.refresh(exc)
    logger.info("Exception released: exception=%s trip=%s by=%s", exception_id, exc.trip_id, user_id)
    _enqueue_claim_changed(db, trip, exc)
    return await _read_with_names(db, exc, trip)


async def review_exceptions_batch(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    exception_ids: Sequence[uuid.UUID],
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    review_note: str,
    review_outcome: DispatcherReviewOutcome,
    contact_method: ExceptionContactMethod | None,
) -> list[TripExceptionRead]:
    """Review several non-critical exceptions on one trip in one transaction (FP-280).

    All or nothing: every rule is checked against every locked row before any row is
    written, so a 404/409/422 leaves the batch untouched. Per row, the single-review
    rules hold — a colleague's claim or review is a 409; a row this dispatcher already
    reviewed is left exactly as it is (a replayed batch is idempotent); an unclaimed row
    is auto-claimed. Critical rows are refused: each one gets its own review.

    Raises:
        ResourceNotFoundError: an id is missing or in another organisation (-> 404).
        BatchReviewRejectedError: a critical row, or rows from another trip (-> 422).
        ExceptionClaimedByColleagueError / ExceptionAlreadyReviewedError (-> 409).
    """
    rows = (await db.execute(
        select(TripException, Trip)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(TripException.id.in_(exception_ids), Trip.operator_organization_id == organization_id)
        .order_by(TripException.id)
        .with_for_update(of=TripException)
    )).tuples().all()
    found = {exc.id: exc for exc, _trip in rows}
    missing = [eid for eid in exception_ids if eid not in found]
    if missing:
        raise ResourceNotFoundError("TripException", str(missing[0]))
    trip = rows[0][1]

    if any(exc.trip_id != trip_id for exc in found.values()):
        raise BatchReviewRejectedError("Every exception in a batch review must belong to the same trip.")
    if any(exc.severity == ExceptionSeverity.CRITICAL for exc in found.values()):
        raise BatchReviewRejectedError("Critical exceptions are reviewed one at a time, never in a batch.")
    for exc in found.values():
        if exc.review_status == ExceptionReviewStatus.REVIEWED:
            if exc.reviewed_by_user_id != user_id:
                raise ExceptionAlreadyReviewedError(str(exc.id))
        elif exc.claimed_by_user_id is not None and exc.claimed_by_user_id != user_id:
            raise ExceptionClaimedByColleagueError(str(exc.id))

    now = datetime.now(UTC)
    outcome = ExceptionReviewOutcome(review_outcome.value)
    newly_reviewed = [exc for exc in found.values() if exc.review_status != ExceptionReviewStatus.REVIEWED]
    for exc in newly_reviewed:
        if exc.claimed_by_user_id is None:
            exc.claimed_by_user_id = user_id
            exc.claimed_at = now
        exc.review_status = ExceptionReviewStatus.REVIEWED
        exc.review_outcome = outcome
        exc.reviewed_by_user_id = user_id
        exc.reviewed_at = now
        exc.review_note = review_note
        exc.contact_method = contact_method
    await db.flush()
    for exc in newly_reviewed:
        await db.refresh(exc)
        await anchor_review(db, exception=exc)

    if newly_reviewed:
        logger.info(
            "Exceptions batch-reviewed: trip=%s by=%s count=%d outcome=%s",
            trip_id, user_id, len(newly_reviewed), review_outcome.value,
        )
        enqueue_event(db, trip.operator_organization_id, TripEvent(
            id=trip_id, kind=RealtimeKind.EXCEPTION_REVIEWED,
            severity=event_severity(ExceptionSeverity.INFO),
        ))

    ordered = sorted(found.values(), key=lambda exc: (exc.created_at, exc.id), reverse=True)
    return await with_reviewer_names(
        db, organization_id=organization_id, reads=[await _read_with_anchors(db, exc, trip) for exc in ordered],
    )
