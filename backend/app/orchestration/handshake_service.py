"""Handshake state machine — advance_h1 through advance_h5.

Each function:
  1. Loads the trip, verifies it belongs to the calling driver and that the
     requested handshake is the correct next step for Trip.status (raises
     HandshakeSequenceError otherwise).
  2. Mutates the HandshakeEvent + Trip rows.
  3. Returns the updated TripDetailResponse.

H2 (Loading) and H5 (Unloading) are anchored to Hedera HCS per
api_contract_dispatcher_driver.md §3.4: a JSON-native canonical payload is
built (compute_h2_canonical_payload / compute_h5_canonical_payload), hashed
via the shared compute_payload_hash() (app/blockchain/anchor_service.py — the
same hasher trips and vehicles use, so there is one canonical-hash
implementation, not another copy), then anchor_subject() submits it to Hedera,
persists a BlockchainReceipt, and event.blockchain_receipt_id is set to it.
anchor_subject() raises HederaTimeoutError/HederaServiceError uncaught on
failure — callers (the handshake endpoints) map these to 504/502, and because
the anchor call happens before the corresponding Trip.status transition below,
a failed anchor leaves the trip in its prior state rather than half-advanced.
H1, H3, H4 remain unanchored feeders by design — they record cross-checks
(GPS, guard sign-off, seal continuity) that support the anchored H2/H5
handshakes but are not themselves committed to chain.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.models.enums import (
    BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType, HandshakeStatus,
    HandshakeType, SubjectType, TripStatus,
)
from app.db.models.handshakes import HandshakeEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.resource_service import get_trip_detail
from app.schemas.handshakes import (
    H1CompleteRequest, H2CompleteRequest, H3CompleteRequest, H4CompleteRequest, H5CompleteRequest,
)
from app.schemas.trips import TripDetailResponse


async def _load_trip_for_handshake(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    expected_status: TripStatus, handshake_label: str,
) -> Trip:
    result = await db.execute(select(Trip).where(Trip.id == trip_id, Trip.driver_id == driver_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.status in (TripStatus.CANCELLED, TripStatus.CLOSED):
        raise HandshakeSequenceError(trip.status.value, handshake_label)
    if trip.status != expected_status:
        raise HandshakeSequenceError(trip.status.value, handshake_label)
    return trip


async def _get_handshake_event(db: AsyncSession, *, trip_id: uuid.UUID, handshake_type: HandshakeType) -> HandshakeEvent:
    result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == handshake_type,
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        sequence_number = list(HandshakeType).index(handshake_type)
        event = HandshakeEvent(
            trip_id=trip_id, handshake_type=handshake_type,
            sequence_number=sequence_number, status=HandshakeStatus.PENDING,
        )
        db.add(event)
        await db.flush()
    return event


async def advance_h1(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H1CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.CREATED, handshake_label="H1 Origin Gate-In",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.ORIGIN_GATE_IN)

    # GPS cross-reference against Pulsit horse GPS is a feeder check (H1 is not
    # anchored to Hedera) — Pulsit integration itself is out of scope for this
    # plan; until it lands, horse_gps fields stay null and the check is skipped
    # rather than faked, so dispatchers see an honest "not yet cross-checked" state.
    event.driver_phone_lat = payload.driver_phone_lat
    event.driver_phone_lng = payload.driver_phone_lng
    event.gate_photo_artifact_id = payload.gate_photo_artifact_id
    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)

    trip.status = TripStatus.ORIGIN_GATE_IN
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)


def compute_h2_canonical_payload(
    *, handshake_event_id: uuid.UUID, trip_id: uuid.UUID, seal_number: str, driver_visual_count: int,
) -> dict[str, str | int]:
    """Canonical H2 (Loading) payload anchored to Hedera.

    JSON-native (UUIDs stringified explicitly) so compute_payload_hash's plain
    json.dumps (no default=str fallback) never has to guess how to serialize a
    value. Deliberately excludes GPS, photos, and artifact IDs — only hashes of
    evidence belong on-chain, never GPS/PII (POPIA); completed_at is excluded
    too, to avoid datetime round-trip fragility when verification reconstructs
    this payload later.
    """
    return {
        "handshake_event_id": str(handshake_event_id),
        "trip_id": str(trip_id),
        "handshake_type": "loading",
        "seal_number": seal_number,
        "driver_visual_count": driver_visual_count,
    }


async def advance_h2(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H2CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.ORIGIN_GATE_IN, handshake_label="H2 Loading",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.LOADING)

    event.waybill_photo_artifact_id = payload.waybill_photo_artifact_id
    event.seal_number = payload.seal_number
    event.seal_photo_artifact_id = payload.seal_photo_artifact_id
    event.driver_visual_count = payload.driver_visual_count

    canonical_payload = compute_h2_canonical_payload(
        handshake_event_id=event.id, trip_id=trip_id,
        seal_number=payload.seal_number, driver_visual_count=payload.driver_visual_count,
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchor before flipping trip.status: anchor_subject() raises uncaught on
    # Hedera failure, so if it fails the trip never advances to LOADING — the
    # driver retries H2 cleanly instead of the record silently drifting ahead
    # of what's actually anchored.
    receipt = await anchor_subject(
        db, subject_type=SubjectType.HANDSHAKE_EVENT, subject_id=event.id,
        canonical_payload=canonical_payload, receipt_type=BlockchainReceiptType.PICKUP,
        trip_id=trip_id,
    )
    event.blockchain_receipt_id = receipt.id

    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)

    trip.status = TripStatus.LOADING
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)


async def advance_h3(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H3CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.LOADING, handshake_label="H3 Origin Gate-Out",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.ORIGIN_GATE_OUT)

    event.gate_photo_artifact_id = payload.gate_exit_photo_artifact_id
    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)
    # Pulsit geofence departure confirmation is out of scope until the Pulsit
    # integration lands; pulsit_geofence_confirmed stays null until then.

    trip.status = TripStatus.IN_TRANSIT
    trip.actual_departure_at = datetime.now(UTC)
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)


async def advance_h4(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H4CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.IN_TRANSIT, handshake_label="H4 Destination Gate-In",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.DEST_GATE_IN)

    h2_result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == HandshakeType.LOADING,
        )
    )
    h2_event = h2_result.scalar_one()

    event.gate_photo_artifact_id = payload.gate_entry_photo_artifact_id
    event.seal_number = payload.seal_number_at_destination
    event.completed_at = datetime.now(UTC)

    if payload.seal_number_at_destination != h2_event.seal_number:
        event.status = HandshakeStatus.EXCEPTION
        trip.status = TripStatus.EXCEPTION_HOLD
        db.add(TripException(
            trip_id=trip_id, handshake_event_id=event.id,
            exception_type=ExceptionType.SEAL_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.CRITICAL,
            description=(
                f"Seal at destination ('{payload.seal_number_at_destination}') does not match "
                f"the seal committed at loading ('{h2_event.seal_number}')."
            ),
        ))
    else:
        event.status = HandshakeStatus.COMPLETED
        trip.status = TripStatus.DEST_GATE_IN

    await db.flush()
    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)


def compute_h5_canonical_payload(
    *, handshake_event_id: uuid.UUID, trip_id: uuid.UUID, pp_scan_in_count: int, driver_visual_count: int,
) -> dict[str, str | int]:
    """Canonical H5 (Unloading) payload anchored to Hedera.

    Anchored unconditionally, independent of whether the counts match — a
    mismatch is evidence in its own right (recorded separately as a
    TripException), not a reason to withhold the anchor. Same POPIA/JSON-native
    rules as compute_h2_canonical_payload: no GPS/photos/PII, no completed_at.
    """
    return {
        "handshake_event_id": str(handshake_event_id),
        "trip_id": str(trip_id),
        "handshake_type": "unloading",
        "pp_scan_in_count": pp_scan_in_count,
        "driver_visual_count": driver_visual_count,
    }


async def advance_h5(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID, payload: H5CompleteRequest,
) -> TripDetailResponse:
    trip = await _load_trip_for_handshake(
        db, trip_id=trip_id, driver_id=driver_id,
        expected_status=TripStatus.DEST_GATE_IN, handshake_label="H5 Unloading",
    )
    event = await _get_handshake_event(db, trip_id=trip_id, handshake_type=HandshakeType.UNLOADING)

    h2_result = await db.execute(
        select(HandshakeEvent).where(
            HandshakeEvent.trip_id == trip_id, HandshakeEvent.handshake_type == HandshakeType.LOADING,
        )
    )
    h2_event = h2_result.scalar_one()
    origin_count = h2_event.driver_visual_count

    event.pod_photo_artifact_id = payload.pod_photo_artifact_id
    event.pod_signature_artifact_id = payload.pod_signature_artifact_id
    event.driver_visual_count = payload.driver_visual_count
    event.parcel_count_destination = payload.pp_scan_in_count

    canonical_payload = compute_h5_canonical_payload(
        handshake_event_id=event.id, trip_id=trip_id,
        pp_scan_in_count=payload.pp_scan_in_count, driver_visual_count=payload.driver_visual_count,
    )
    event.event_hash = compute_payload_hash(canonical_payload)

    # Anchor before flipping trip.status, same rollback-safety rationale as H2.
    # Runs regardless of the count-mismatch branch below — the anchor commits
    # exactly what the driver/PP attested at unload, match or not.
    receipt = await anchor_subject(
        db, subject_type=SubjectType.HANDSHAKE_EVENT, subject_id=event.id,
        canonical_payload=canonical_payload, receipt_type=BlockchainReceiptType.DELIVERY,
        trip_id=trip_id,
    )
    event.blockchain_receipt_id = receipt.id
    event.completed_at = datetime.now(UTC)

    counts_match = (
        origin_count == payload.pp_scan_in_count == payload.driver_visual_count
    )
    if not counts_match:
        db.add(TripException(
            trip_id=trip_id, handshake_event_id=event.id,
            exception_type=ExceptionType.WAYBILL_COUNT_MISMATCH, source=ExceptionSource.SYSTEM,
            severity=ExceptionSeverity.WARNING,
            description=(
                f"Count mismatch at unload: origin={origin_count}, "
                f"PP scan-in={payload.pp_scan_in_count}, driver visual={payload.driver_visual_count}."
            ),
        ))
        event.status = HandshakeStatus.EXCEPTION
    else:
        event.status = HandshakeStatus.COMPLETED

    # A count mismatch is a WARNING, not a hold — the trip still closes; the
    # dispatcher reconciles afterward. This differs from H4's seal mismatch
    # (CRITICAL, holds the trip) per api_contract_dispatcher_driver.md §3.4.
    trip.status = TripStatus.CLOSED
    trip.closed_at = datetime.now(UTC)
    trip.actual_arrival_at = trip.actual_arrival_at or datetime.now(UTC)
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
