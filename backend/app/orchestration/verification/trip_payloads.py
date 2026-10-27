"""Rebuild a trip's journey-lock payload from live rows, as the generation its receipt was anchored as."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.hashing import (
    TRIP_PAYLOAD_VERSION_V2, PPManifestKey, StopCommitment, compute_snapshot_sha256,
    compute_trip_canonical_payload, compute_trip_canonical_payload_v2,
)
from app.db.models.trips import Trip, TripStop, TripTrailer
from app.orchestration.consignments.manifest_reads import load_creation_snapshot
from app.orchestration.verification.errors import _UnsupportedPhasePayloadVersion

_LEGACY_TRIP_PAYLOAD_VERSION = 1


def _trip_payload_version(anchored_payload: Any) -> int:
    """Which journey-lock generation the receipt was anchored as.

    Read from the receipt's stored payload_json, which is safe even though the database is
    the thing under suspicion: the result is only ever compared against the receipt's
    data_hash, which is also what Hedera holds. Editing payload_json down to v1 makes the
    rebuild a v1 payload, and a v1 payload cannot hash to a v2 anchored hash.
    """
    if not isinstance(anchored_payload, dict):
        raise _UnsupportedPhasePayloadVersion("trip receipt payload must be a JSON object")
    if "payload_version" not in anchored_payload:
        return _LEGACY_TRIP_PAYLOAD_VERSION

    version = anchored_payload["payload_version"]
    if type(version) is not int or version != TRIP_PAYLOAD_VERSION_V2:
        raise _UnsupportedPhasePayloadVersion(f"unsupported trip payload version: {version!r}")
    return version


async def _reconstruct_trip_payload(
    db: AsyncSession, trip_id: uuid.UUID, *, anchored_payload: Any,
) -> dict[str, Any] | None:
    """Rebuild the canonical journey-lock payload from live DB rows.

    The generation (v1 without stops, v2 with them) is the one the receipt was anchored
    as. For a manifest trip the snapshot hash is RECOMPUTED from H0's stored snapshot, never
    read from a stored hash: editing or deleting the snapshot must show as tampering.
    """
    version = _trip_payload_version(anchored_payload)
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
        return None

    manifest_key: PPManifestKey | None = None
    snapshot_sha256: str | None = None
    if (
        trip.pp_manifest_issuer_account is not None
        and trip.pp_manifest_origin_hub is not None
        and trip.pp_manifest_number is not None
    ):
        manifest_key = PPManifestKey(
            trip.pp_manifest_issuer_account, trip.pp_manifest_origin_hub, trip.pp_manifest_number,
        )
        snapshot = await load_creation_snapshot(db, trip_id)
        snapshot_sha256 = compute_snapshot_sha256(snapshot) if snapshot is not None else None

    fields: dict[str, Any] = dict(
        trip_id=trip.id,
        driver_id=trip.driver_id,
        horse_id=trip.horse_id,
        trailer_ids=list(trailer_rows),
        origin_precinct_id=trip.origin_precinct_id,
        destination_precinct_id=trip.destination_precinct_id,
        created_by_user_id=trip.created_by_user_id,
        created_at=trip.created_at,
        trip_type=trip.trip_type,
        pp_manifest=manifest_key,
        pp_manifest_snapshot_sha256=snapshot_sha256,
        planned_departure_at=trip.planned_departure_at,
        planned_arrival_at=trip.planned_arrival_at,
    )
    if version == _LEGACY_TRIP_PAYLOAD_VERSION:
        return compute_trip_canonical_payload(**fields)

    stop_rows = (
        await db.execute(
            select(TripStop.sequence, TripStop.precinct_id, TripStop.slot_time)
            .where(TripStop.trip_id == trip_id)
            .order_by(TripStop.sequence)
        )
    ).all()
    return compute_trip_canonical_payload_v2(
        **fields, stops=[StopCommitment(*row) for row in stop_rows],
    )
