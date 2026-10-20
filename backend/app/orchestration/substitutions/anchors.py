"""Anchor completed handovers and their corrections to Hedera, with recoverable debt (FP-83 C5).

The evidence-anchor pattern (orchestration/evidence_anchors), applied to custody:

- Freeze: the commitment (substitutions.canonical) and its hash are written with the completion
  or correction, in the same transaction, status PENDING. A rollback leaves neither.
- Dispatch: only `(kind, id)` crosses the broker, after the OUTER commit (the shared savepoint-
  safe hook). The broker and the local fallback are injected by the task layer at startup, so
  this module never imports tasks/.
- Execute: lock the row; a linked receipt that matches is success; otherwise the stored payload
  must still hash to the frozen hash AND the live rows must still rebuild to it, or the row is
  marked FAILED and never re-baselined. Hedera trouble is FAILED debt, never a reversal of
  custody: anchoring is evidence about a transfer, not a condition of it.
- Recover: a periodic sweep retries PENDING/FAILED rows with no receipt, SKIP LOCKED.

`verify_custody_chain` is the dispatcher's integrity read over the whole chain.
"""

import asyncio
import enum
import logging
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.exceptions import HederaServiceError, HederaTimeoutError, ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.driver_substitutions import DriverSubstitutionCorrection, DriverSubstitutionRequest
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, SubjectType
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.evidence_anchors.dispatch import run_after_outer_commit
from app.orchestration.substitutions import canonical
from app.orchestration.substitutions.access import CustodyChainError, completed_links, derive_custody
from app.orchestration.verification.substitution_payloads import (
    rebuild_correction_payload, rebuild_substitution_payload,
)
from app.schemas.driver_substitutions import CustodyIntegrityRead, CustodyIntegrityStatus, SubstitutionState

logger = logging.getLogger(__name__)

_OWED = (AnchorStatus.PENDING.value, AnchorStatus.FAILED.value)


class CustodyAnchorKind(str, enum.Enum):
    SUBSTITUTION = "substitution"
    CORRECTION = "correction"


# ── freeze ───────────────────────────────────────────────────────────────────


async def freeze_substitution(db: AsyncSession, row: DriverSubstitution) -> None:
    """Write the completed handover's commitment and queue its anchor (after the outer commit).
    Called by the completion, in its transaction, once every fact the record reads is flushed."""
    payload = await rebuild_substitution_payload(db, row.id)
    if payload is None:  # a completion always has a request; reaching here is a caller bug
        raise ValueError(f"substitution {row.id} has no request to commit to")
    row.payload_version = canonical.SUBSTITUTION_PAYLOAD_VERSION
    row.payload_json = payload
    row.event_hash = compute_payload_hash(payload)
    row.anchor_status = AnchorStatus.PENDING.value
    await db.flush()
    dispatch_custody_anchor(db, kind=CustodyAnchorKind.SUBSTITUTION, record_id=row.id)


# ── dispatch ─────────────────────────────────────────────────────────────────

_BACKGROUND_CUSTODY_TASKS: set[asyncio.Task[bool]] = set()


@dataclass(frozen=True)
class CustodyPublisher:
    """The task layer's broker call (kind, id as strings) and its in-process last resort."""

    publish: Callable[[str, str], object]
    anchor_locally: Callable[[CustodyAnchorKind, uuid.UUID], Coroutine[Any, Any, bool]]


_publisher: CustodyPublisher | None = None


def configure_custody_publisher(publisher: CustodyPublisher | None) -> None:
    global _publisher
    _publisher = publisher


def dispatch_custody_anchor(db: AsyncSession, *, kind: CustodyAnchorKind, record_id: uuid.UUID) -> None:
    def _start() -> None:
        _retain(asyncio.get_running_loop().create_task(_publish(kind, record_id)), record_id)

    run_after_outer_commit(db, _start)


async def _publish(kind: CustodyAnchorKind, record_id: uuid.UUID) -> bool:
    publisher = _publisher
    if publisher is None:
        logger.error("No custody publisher configured; %s %s will be anchored by the recovery sweep", kind.value, record_id)
        return False
    try:
        await asyncio.to_thread(publisher.publish, kind.value, str(record_id))
    except Exception:  # noqa: BLE001 — any broker failure, not just one library's
        logger.exception("Could not queue the anchor for %s %s; scheduling local fallback", kind.value, record_id)
        _retain(asyncio.get_running_loop().create_task(publisher.anchor_locally(kind, record_id)), record_id)
    return True


def _retain(task: asyncio.Task[bool], record_id: uuid.UUID) -> None:
    _BACKGROUND_CUSTODY_TASKS.add(task)

    def _observe(completed: asyncio.Task[bool]) -> None:
        _BACKGROUND_CUSTODY_TASKS.discard(completed)
        try:
            completed.result()
        except asyncio.CancelledError:
            logger.warning("Custody anchor work cancelled for %s; recovery will retry", record_id)
        except Exception:  # noqa: BLE001 — task boundary must observe every failure
            logger.exception("Custody anchor work failed for %s; recovery will retry", record_id)

    task.add_done_callback(_observe)


# ── execute ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Target:
    """How one kind maps onto the shared execute path."""

    subject_type: SubjectType
    receipt_type: BlockchainReceiptType
    receipt_field: str  # the row's receipt FK column


_TARGETS = {
    CustodyAnchorKind.SUBSTITUTION: _Target(
        SubjectType.DRIVER_SUBSTITUTION, BlockchainReceiptType.DRIVER_SUBSTITUTION, "blockchain_receipt_id",
    ),
    CustodyAnchorKind.CORRECTION: _Target(
        SubjectType.DRIVER_SUBSTITUTION_CORRECTION, BlockchainReceiptType.DRIVER_SUBSTITUTION_CORRECTED, "receipt_id",
    ),
}


async def _locked_row(
    db: AsyncSession, kind: CustodyAnchorKind, record_id: uuid.UUID,
) -> tuple[DriverSubstitution | DriverSubstitutionCorrection, uuid.UUID] | None:
    """The row (locked) and its trip id."""
    if kind is CustodyAnchorKind.SUBSTITUTION:
        sub = (await db.execute(
            select(DriverSubstitution).where(DriverSubstitution.id == record_id).with_for_update()
        )).scalar_one_or_none()
        return None if sub is None else (sub, sub.trip_id)
    found = (await db.execute(
        select(DriverSubstitutionCorrection, DriverSubstitution.trip_id)
        .join(DriverSubstitution, DriverSubstitution.id == DriverSubstitutionCorrection.substitution_id)
        .where(DriverSubstitutionCorrection.id == record_id).with_for_update(of=DriverSubstitutionCorrection)
    )).one_or_none()
    return None if found is None else (found[0], found[1])


async def _rebuild(db: AsyncSession, kind: CustodyAnchorKind, record_id: uuid.UUID) -> dict[str, object] | None:
    if kind is CustodyAnchorKind.SUBSTITUTION:
        return await rebuild_substitution_payload(db, record_id)
    return await rebuild_correction_payload(db, record_id)


async def anchor_custody_record(db: AsyncSession, *, kind: CustodyAnchorKind, record_id: uuid.UUID) -> bool:
    """Anchor one handover or correction. Returns whether it ends linked to a valid receipt.

    The caller owns the transaction. Celery delivery is at-least-once, so the row is locked and a
    linked receipt is never submitted twice by this path (exactly-once on HCS is not claimed: a
    crash between Hedera's acceptance and the commit can still repeat a message).
    """
    target = _TARGETS[kind]
    found = await _locked_row(db, kind, record_id)
    if found is None:
        logger.error("Anchor requested for unknown %s %s", kind.value, record_id)
        return False
    row, trip_id = found
    if row.event_hash is None or row.payload_json is None:
        logger.error("%s %s has no frozen commitment (legacy row); nothing to anchor", kind.value, record_id)
        return False
    row.updated_at = datetime.now(UTC)

    linked_id = getattr(row, target.receipt_field)
    if linked_id is not None:
        receipt = await db.get(BlockchainReceipt, linked_id)
        if (
            receipt is not None and receipt.subject_type == target.subject_type and receipt.subject_id == row.id
            and receipt.receipt_type == target.receipt_type and receipt.data_hash == row.event_hash
        ):
            return True
        logger.error("%s %s links a receipt that does not belong to it", kind.value, record_id)
        return False

    live = await _rebuild(db, kind, record_id)
    if compute_payload_hash(row.payload_json) != row.event_hash or live is None or compute_payload_hash(live) != row.event_hash:
        # Edited after it was frozen: never anchored, never re-baselined.
        logger.error("%s %s: stored or live state no longer matches its frozen hash", kind.value, record_id)
        row.anchor_status = AnchorStatus.FAILED.value
        return False

    try:
        receipt = await anchor_subject(
            db, subject_type=target.subject_type, subject_id=row.id, canonical_payload=row.payload_json,
            receipt_type=target.receipt_type, trip_id=trip_id,
        )
    except (HederaTimeoutError, HederaServiceError) as error:
        logger.error("Anchor failed for %s %s (retry owed): %s", kind.value, record_id, type(error).__name__)
        row.anchor_status = AnchorStatus.FAILED.value
        return False
    setattr(row, target.receipt_field, receipt.id)
    row.anchor_status = AnchorStatus.ANCHORED.value
    return True


# ── recover ──────────────────────────────────────────────────────────────────


async def recover_custody_anchor(db: AsyncSession, *, due_before: datetime) -> bool | None:
    """Attempt one overdue debt (handovers first, then corrections); None when none is eligible."""
    sub_id = (await db.execute(
        select(DriverSubstitution.id).where(
            DriverSubstitution.anchor_status.in_(_OWED), DriverSubstitution.blockchain_receipt_id.is_(None),
            DriverSubstitution.updated_at < due_before,
        ).order_by(DriverSubstitution.updated_at, DriverSubstitution.id).limit(1).with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if sub_id is not None:
        return await anchor_custody_record(db, kind=CustodyAnchorKind.SUBSTITUTION, record_id=sub_id)
    correction_id = (await db.execute(
        select(DriverSubstitutionCorrection.id).where(
            DriverSubstitutionCorrection.anchor_status.in_(_OWED), DriverSubstitutionCorrection.receipt_id.is_(None),
            DriverSubstitutionCorrection.updated_at < due_before,
        ).order_by(DriverSubstitutionCorrection.updated_at, DriverSubstitutionCorrection.id)
        .limit(1).with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if correction_id is not None:
        return await anchor_custody_record(db, kind=CustodyAnchorKind.CORRECTION, record_id=correction_id)
    return None


# ── integrity read ───────────────────────────────────────────────────────────


async def _chain_findings(db: AsyncSession, trip: Trip, rows: list[DriverSubstitution]) -> list[str]:
    findings: list[str] = []
    try:
        derive_custody(trip.driver_id, await completed_links(db, trip_id=trip.id))
    except CustodyChainError as error:
        findings.append(f"Custody chain is broken: {error}")
    by_id = {row.id: row for row in rows}
    for row in rows:
        if row.request_id is None:
            continue  # legacy amendment: no commitment was ever recorded, and none is invented
        if row.event_hash is None or row.payload_json is None:
            findings.append(f"Amendment {row.sequence_number} has no frozen commitment.")
            continue
        live = await rebuild_substitution_payload(db, row.id)
        if compute_payload_hash(row.payload_json) != row.event_hash or live is None or compute_payload_hash(live) != row.event_hash:
            findings.append(f"Amendment {row.sequence_number} no longer matches its commitment.")
        previous = by_id.get(row.previous_substitution_id) if row.previous_substitution_id else None
        if row.payload_json.get("previous_event_hash") != (previous.event_hash if previous else None):
            findings.append(f"Amendment {row.sequence_number} does not follow the amendment before it.")
    return findings


async def _missing_rows(db: AsyncSession, trip_id: uuid.UUID, rows: list[DriverSubstitution]) -> list[str]:
    """Evidence an amendment existed that the remaining rows no longer show: a completed request
    or a trip-linked substitution receipt with no row. Deleting the newest amendment cannot make
    the shortened chain read as complete."""
    findings: list[str] = []
    present = {row.request_id for row in rows}
    completed = (await db.execute(select(DriverSubstitutionRequest.id).where(
        DriverSubstitutionRequest.trip_id == trip_id, DriverSubstitutionRequest.state == SubstitutionState.COMPLETED.value,
    ))).scalars().all()
    findings.extend(f"Completed handover {request_id} has no custody amendment." for request_id in completed if request_id not in present)
    row_ids = {row.id for row in rows}
    receipts = (await db.execute(select(BlockchainReceipt).where(
        BlockchainReceipt.trip_id == trip_id, BlockchainReceipt.subject_type == SubjectType.DRIVER_SUBSTITUTION.value,
    ))).scalars().all()
    for receipt in receipts:
        if receipt.subject_id not in row_ids:
            findings.append(f"An anchored amendment ({receipt.subject_id}) is missing from the chain.")
        elif receipt.receipt_type != BlockchainReceiptType.DRIVER_SUBSTITUTION.value:
            findings.append(f"Amendment {receipt.subject_id} carries a receipt of the wrong kind.")
    return findings


async def verify_custody_chain(db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID) -> CustodyIntegrityRead:
    """The dispatcher's integrity read for a trip's custody chain, from live rows.

    Checks continuity, each amendment's commitment against its live rows, the previous-hash links,
    and rows that should exist but do not. It does not call Hedera or re-read Storage on every
    detail read; the per-receipt /verify path does both for one amendment.
    """
    trip = (await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id)
    )).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    rows = list((await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == trip_id).order_by(DriverSubstitution.sequence_number)
    )).scalars())
    findings = [*await _chain_findings(db, trip, rows), *await _missing_rows(db, trip_id, rows)]
    pending_corrections = (await db.execute(
        select(func.count()).select_from(DriverSubstitutionCorrection)
        .join(DriverSubstitution, DriverSubstitution.id == DriverSubstitutionCorrection.substitution_id)
        .where(DriverSubstitution.trip_id == trip_id, DriverSubstitutionCorrection.anchor_status.in_(_OWED))
    )).scalar_one()
    pending = sum(1 for row in rows if row.anchor_status in _OWED) + pending_corrections
    status = (
        CustodyIntegrityStatus.FAILED if findings
        else CustodyIntegrityStatus.PENDING if pending
        else CustodyIntegrityStatus.VERIFIED
    )
    return CustodyIntegrityRead(status=status, amendment_count=len(rows), pending_anchor_count=pending, findings=findings)
