"""Handshake state machine — advance_h1 through advance_h5.

Each function:
  1. Loads the trip, verifies it belongs to the calling driver and that the
     requested handshake is the correct next step for Trip.status (raises
     HandshakeSequenceError otherwise).
  2. Mutates the HandshakeEvent + Trip rows.
  3. Returns the updated TripDetailResponse.

Hedera anchoring is intentionally NOT called here yet (H2/H5 normally queue an
HCS receipt anchor per api_contract_dispatcher_driver.md §3.4) — that work is
deferred. event_hash is computed and stored so the anchor call is a drop-in
follow-up, not a redesign.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import HandshakeSequenceError, ResourceNotFoundError
from app.db.models.enums import (
    ExceptionSeverity, ExceptionSource, ExceptionType, HandshakeStatus, HandshakeType, TripStatus,
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


def _compute_event_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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
    event.event_hash = _compute_event_hash({
        "trip_id": str(trip_id), "seal_number": payload.seal_number,
        "driver_visual_count": payload.driver_visual_count,
    })
    event.status = HandshakeStatus.COMPLETED
    event.completed_at = datetime.now(UTC)

    # Hedera pickup receipt anchor is deferred (see module docstring) — when
    # that work starts, queue it here with event.event_hash as the payload.
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
    event.event_hash = _compute_event_hash({
        "trip_id": str(trip_id), "pp_scan_in_count": payload.pp_scan_in_count,
        "driver_visual_count": payload.driver_visual_count,
    })
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
    # Hedera delivery receipt anchor is deferred (see module docstring).
    await db.flush()

    return await get_trip_detail(db, trip_id=trip_id, operator_organization_id=trip.operator_organization_id)
