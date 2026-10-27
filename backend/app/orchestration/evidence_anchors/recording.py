"""Write the anchor event for an action, inside the action's own transaction.

No Hedera call and no commit happen here: the source rows, the membership and the frozen
event all become durable together, or none do. The caller dispatches the event id only after
the outer transaction commits (dispatch.py).
"""

import uuid
from collections.abc import Sequence
from enum import Enum
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.enums import (
    AnchorStatus, BlockchainReceiptType, ExceptionReviewOutcome, ExceptionReviewStatus, ExceptionSeverity,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.evidence_anchors import canonical
from app.orchestration.evidence_anchors.artifacts import attach_exception_artifacts, load_exception_artifacts
from app.orchestration.evidence_anchors.dispatch import dispatch_evidence_anchor


def _text(value: Any) -> str:
    """Enum columns come back as plain strings from the database but as members right after
    an in-session assignment; the canonical payload needs the value either way."""
    return value.value if isinstance(value, Enum) else str(value)


def build_exception_record(
    exception: TripException, artifacts: list[EvidenceArtifact],
) -> canonical.ExceptionRecord:
    """The single place a TripException becomes a canonical record — used when the event is
    frozen and again when the verifier rebuilds it, so the two cannot drift."""
    return canonical.ExceptionRecord(
        trip_id=exception.trip_id,
        exception_id=exception.id,
        created_at=exception.created_at,
        exception_type=_text(exception.exception_type),
        source=_text(exception.source),
        severity=_text(exception.severity),
        description=exception.description,
        phase_event_id=exception.phase_event_id,
        checkpoint_id=exception.checkpoint_id,
        consignment_id=exception.consignment_id,
        trip_stop_id=exception.trip_stop_id,
        vehicle_id=exception.vehicle_id,
        photos=tuple(canonical.PhotoCommitment(a.id, a.file_hash) for a in artifacts),
    )


def _new_event(
    exception: TripException, receipt_type: BlockchainReceiptType, payload: dict[str, Any],
    occurred_at: Any,
) -> EvidenceAnchorEvent:
    return EvidenceAnchorEvent(
        id=uuid.UUID(payload["event_id"]),
        trip_id=exception.trip_id,
        exception_id=exception.id,
        receipt_type=receipt_type,
        occurred_at=occurred_at,
        payload_version=canonical.EVIDENCE_PAYLOAD_VERSION,
        payload_json=payload,
        event_hash=compute_payload_hash(payload),
        anchor_status=AnchorStatus.PENDING,
    )


def build_review_record(exception: TripException) -> canonical.ReviewRecord:
    """The review half of an exception as a canonical record. Callers guarantee the row has
    been reviewed (reconstruction checks first and treats a missing field as missing evidence)."""
    assert exception.reviewed_by_user_id is not None and exception.reviewed_at is not None
    outcome = _text(exception.review_outcome)
    return canonical.ReviewRecord(
        reviewed_by_user_id=exception.reviewed_by_user_id,
        reviewed_at=exception.reviewed_at,
        outcome=outcome,
        contact_method=None if exception.contact_method is None else _text(exception.contact_method),
        review_note=exception.review_note,
        authored_description=(
            exception.description if outcome == ExceptionReviewOutcome.DISPATCHER_AUTHORED.value else None
        ),
    )


def build_cancellation_record(exception: TripException, trip: Trip) -> canonical.CancellationRecord:
    """The cancellation of `trip`, whose cause and actor are the cancellation note's own."""
    assert exception.reviewed_by_user_id is not None and trip.closed_at is not None
    return canonical.CancellationRecord(
        trip_id=trip.id,
        exception_id=exception.id,
        cancelled_by_user_id=exception.reviewed_by_user_id,
        closed_at=trip.closed_at,
        cause_description=exception.description,
    )


def _is_reviewed(exception: TripException) -> bool:
    return (
        _text(exception.review_status) == ExceptionReviewStatus.REVIEWED.value
        and exception.reviewed_by_user_id is not None and exception.reviewed_at is not None
    )


async def prepare_exception_anchors(
    db: AsyncSession, *, exception: TripException, cancelled_trip: Trip | None = None,
) -> list[EvidenceAnchorEvent]:
    """Freeze the anchor events a just-created exception owes. Flushes; never commits.

    Called only where an exception is created, with photo membership already written and
    created_at loaded, so a historical exception can never acquire a fabricated raise event.
    Owed at creation: a raise event if critical; a review event if the row is born reviewed
    (a dispatcher-authored note); a cancellation event if `cancelled_trip` is the trip this
    note cancels. Anything else owes none.
    """
    events: list[EvidenceAnchorEvent] = []
    record: canonical.ExceptionRecord | None = None
    if _text(exception.severity) == ExceptionSeverity.CRITICAL.value or _is_reviewed(exception):
        artifacts = await load_exception_artifacts(db, exception=exception)
        record = build_exception_record(exception, artifacts)
    if record is not None and _text(exception.severity) == ExceptionSeverity.CRITICAL.value:
        payload = canonical.exception_raised_payload(event_id=uuid.uuid4(), record=record)
        events.append(_new_event(
            exception, BlockchainReceiptType.EXCEPTION_RAISED, payload, occurred_at=exception.created_at,
        ))
    if record is not None and _is_reviewed(exception):
        events.append(_review_event(exception, record))
    if cancelled_trip is not None:
        payload = canonical.trip_cancelled_payload(
            event_id=uuid.uuid4(), cancellation=build_cancellation_record(exception, cancelled_trip),
        )
        events.append(_new_event(
            exception, BlockchainReceiptType.TRIP_CANCELLED, payload,
            occurred_at=cancelled_trip.closed_at,
        ))
    db.add_all(events)
    await db.flush()
    return events


def _review_event(exception: TripException, record: canonical.ExceptionRecord) -> EvidenceAnchorEvent:
    payload = canonical.exception_reviewed_payload(
        event_id=uuid.uuid4(), record=record, review=build_review_record(exception),
    )
    return _new_event(
        exception, BlockchainReceiptType.EXCEPTION_REVIEWED, payload, occurred_at=exception.reviewed_at,
    )


async def prepare_review_anchor(db: AsyncSession, *, exception: TripException) -> EvidenceAnchorEvent:
    """Freeze the review event for an exception that has JUST been reviewed. Flushes only.

    Separate from prepare_exception_anchors because a review can land on any exception,
    including a historical critical one that never had a raise event; the raise event is
    not owed then, and must not be fabricated. The caller has refreshed the row so the
    record is built from what the database holds.
    """
    artifacts = await load_exception_artifacts(db, exception=exception)
    event = _review_event(exception, build_exception_record(exception, artifacts))
    db.add(event)
    await db.flush()
    return event


async def anchor_review(db: AsyncSession, *, exception: TripException) -> EvidenceAnchorEvent:
    """prepare_review_anchor, then queue it for after the outer commit."""
    event = await prepare_review_anchor(db, exception=exception)
    dispatch_evidence_anchor(db, event_id=event.id)
    return event


async def anchor_created_exception(
    db: AsyncSession, exception: TripException, *, cancelled_trip: Trip | None = None,
) -> list[EvidenceAnchorEvent]:
    """Hook for every site that creates a TripException outside the driver endpoint.

    Cheap when nothing is owed (a warning/info row that is not authored): no flush, no
    query. When something is owed it flushes, loads server-set columns, freezes the events
    and queues them for after the outer commit.
    """
    owed = (
        _text(exception.severity) == ExceptionSeverity.CRITICAL.value
        or _text(exception.review_status) == ExceptionReviewStatus.REVIEWED.value
        or cancelled_trip is not None
    )
    if not owed:
        return []
    await db.flush()
    await db.refresh(exception)
    events = await prepare_exception_anchors(db, exception=exception, cancelled_trip=cancelled_trip)
    for event in events:
        dispatch_evidence_anchor(db, event_id=event.id)
    return events


async def register_exception(
    db: AsyncSession, exception: TripException, *, cancelled_trip: Trip | None = None,
) -> TripException:
    """db.add(exception) plus its anchor hook, for creation sites that write the row inline."""
    db.add(exception)
    await anchor_created_exception(db, exception, cancelled_trip=cancelled_trip)
    return exception


async def anchor_new_report(
    db: AsyncSession, exception: TripException, *, photo_ids: Sequence[uuid.UUID],
) -> list[EvidenceAnchorEvent]:
    """The driver-report path: freeze the photo membership and any owed raise event in the
    same transaction as the report, so a rollback leaves neither; the event ids are queued
    for after the outer commit."""
    await attach_exception_artifacts(db, exception_id=exception.id, artifact_ids=photo_ids)
    events = await prepare_exception_anchors(db, exception=exception)
    for event in events:
        dispatch_evidence_anchor(db, event_id=event.id)
    return events
