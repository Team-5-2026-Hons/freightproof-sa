"""Verify a subject's current DB state against its anchored Hedera record.

Returns one of: verified, db_mismatch, hedera_mismatch, no_receipt, error.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.hedera import HederaService
from app.core.exceptions import HederaServiceError
from app.crypto.hashing import compute_trip_canonical_payload
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.events import DriverEvent, VehicleEvent
from app.db.models.enums import PhaseType, SubjectType, VerifyStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripTrailer
from app.orchestration.phase_service import (
    compute_confirmation_canonical_payload, compute_departure_canonical_payload,
)


@dataclass(frozen=True)
class VerifyOutcome:
    status: VerifyStatus
    receipt: BlockchainReceipt | None = None
    expected_hash: str | None = None
    current_hash: str | None = None


async def _latest_receipt(
    db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID
) -> BlockchainReceipt | None:
    result = await db.execute(
        select(BlockchainReceipt)
        .where(
            BlockchainReceipt.subject_type == subject_type,
            BlockchainReceipt.subject_id == subject_id,
        )
        .order_by(desc(BlockchainReceipt.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _reconstruct_trip_payload(
    db: AsyncSession, trip_id: uuid.UUID, *, anchored_payload: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Rebuild the canonical trip payload from live DB rows, version-dispatching trip_type.

    trip_type is only included if the originally anchored payload had it. Older
    trips were anchored before trip_type existed, so recomputing with it set would
    change the hash and produce a false DB_MISMATCH ("tampering") on untouched rows.
    """
    trip = (
        await db.execute(select(Trip).where(Trip.id == trip_id))
    ).scalar_one_or_none()
    if trip is None:
        return None
    trailer_rows = (
        await db.execute(
            select(TripTrailer.trailer_id).where(TripTrailer.trip_id == trip_id)
        )
    ).scalars().all()
    if trip.origin_precinct_id is None or trip.destination_precinct_id is None:
        # Precincts are set at trip creation; a receipt shouldn't exist before that,
        # but treat it like the other reconstruct_* helpers' not-found case either way.
        return None
    include_trip_type = anchored_payload is not None and "trip_type" in anchored_payload
    return compute_trip_canonical_payload(
        trip_id=trip.id,
        order_number=trip.order_number,
        driver_id=trip.driver_id,
        horse_id=trip.horse_id,
        trailer_ids=list(trailer_rows),
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=trip.created_by_user_id,
        created_at=trip.created_at,
        trip_type=trip.trip_type if include_trip_type else None,
    )


async def _reconstruct_vehicle_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    event = (
        await db.execute(select(VehicleEvent).where(VehicleEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return {
        "vehicle_event_id": str(event.id),
        "vehicle_id": str(event.vehicle_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


async def _reconstruct_driver_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    event = (
        await db.execute(select(DriverEvent).where(DriverEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    return {
        "driver_event_id": str(event.id),
        "driver_id": str(event.driver_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }


async def _reconstruct_phase_event_payload(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[str, Any] | None:
    """Rebuild the exact canonical payload anchored at departure/confirmation, from the live row.

    Reuses compute_departure_canonical_payload/compute_confirmation_canonical_payload
    from phase_service directly — one payload-shape definition, not a second
    copy that could drift from what was actually anchored. Any phase_type
    other than DEPARTURE/CONFIRMATION (activation, loading, unloading, and
    trip_creation) was never anchored as SubjectType.PHASE_EVENT, so it
    returns None and the caller falls through to NO_RECEIPT.

    Task 2.6 (D7/T5) moved the seal — and the anchor with it — from loading to
    departure, so this dispatches on PhaseType.DEPARTURE, not LOADING, and no
    longer needs driver_visual_count (which stays on loading, unanchored).
    """
    event = (
        await db.execute(select(PhaseEvent).where(PhaseEvent.id == event_id))
    ).scalar_one_or_none()
    if event is None:
        return None
    if event.phase_type == PhaseType.DEPARTURE:
        # seal_number is a nullable column (not yet completed), but a receipt
        # only ever exists once departure anchored it. If it's still None here,
        # treat it like NO_RECEIPT rather than hash a payload that could never
        # match what was actually anchored.
        if event.seal_number is None:
            return None
        return compute_departure_canonical_payload(
            phase_event_id=event.id, trip_id=event.trip_id, seal_number=event.seal_number,
        )
    if event.phase_type == PhaseType.CONFIRMATION:
        if event.parcel_count_destination is None or event.driver_visual_count is None:
            return None
        return compute_confirmation_canonical_payload(
            phase_event_id=event.id, trip_id=event.trip_id,
            pp_scan_in_count=event.parcel_count_destination,
            driver_visual_count=event.driver_visual_count,
        )
    return None


def _hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


async def verify_subject(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    hedera_service: HederaService | None = None,
) -> VerifyOutcome:
    receipt = await _latest_receipt(db, subject_type, subject_id)
    if receipt is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT)

    if subject_type == SubjectType.TRIP:
        rebuilt = await _reconstruct_trip_payload(
            db, subject_id, anchored_payload=receipt.payload_json
        )
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.VEHICLE_EVENT:
        rebuilt = await _reconstruct_vehicle_event_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.DRIVER_EVENT:
        rebuilt = await _reconstruct_driver_event_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    elif subject_type == SubjectType.PHASE_EVENT:
        rebuilt = await _reconstruct_phase_event_payload(db, subject_id)
        if rebuilt is None:
            return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
        current_hash = _hash_payload(rebuilt)
    else:
        # vehicle/driver subject types not currently verifiable directly
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)

    if current_hash != receipt.data_hash:
        return VerifyOutcome(
            status=VerifyStatus.DB_MISMATCH,
            receipt=receipt,
            expected_hash=receipt.data_hash,
            current_hash=current_hash,
        )

    if not receipt.hedera_topic_id or not receipt.hedera_sequence_number:
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)

    service = hedera_service or HederaService()
    try:
        # verify_hash() is a synchronous httpx GET to the Hedera mirror node (up to a
        # 10s timeout) — run it off the event loop so a slow mirror node stalls only
        # this request, not every other request the server is handling.
        match = await asyncio.to_thread(
            service.verify_hash,
            receipt.hedera_topic_id,
            receipt.hedera_sequence_number,
            receipt.data_hash,
        )
    except HederaServiceError:
        # Mirror node unreachable, bad stored topic_id, SDK error — infrastructure failure,
        # not evidence of tamper. Return ERROR so the UI can distinguish it from HEDERA_MISMATCH.
        return VerifyOutcome(status=VerifyStatus.ERROR, receipt=receipt)
    if not match:
        return VerifyOutcome(status=VerifyStatus.HEDERA_MISMATCH, receipt=receipt)

    return VerifyOutcome(status=VerifyStatus.VERIFIED, receipt=receipt)
