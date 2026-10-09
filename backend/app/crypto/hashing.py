"""SHA-256 hashing utilities for FreightProof evidence integrity.

compute_trip_canonical_payload() is the journey lock: a trip's immutable parameters
at creation. Its hash is stored on the Trip row and anchored to Hedera HCS, so a
later mismatch indicates tampering. verify_subject() rebuilds the same dict from
live rows.

The payload has a FIXED key set (FP-281, spec §9): every key is always present, null
when absent. Reconstruction has one deterministic shape, and verification never has
to guess which keys an older trip was anchored with.

Two payload generations exist and both stay verifiable for as long as their receipts do.
v1 (no payload_version key) predates stop commitment; v2 adds the ordered stops. The
generation is read from the anchored receipt, never inferred (see verification_service).
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime
from collections.abc import Sequence
from typing import Any, NamedTuple


class PPManifestKey(NamedTuple):
    """A trip's external key (spec §6). A manifest number is unique only within one
    client's PP system, and may restart per branch — hence issuer account and hub."""

    issuer_account: str
    origin_hub: str
    number: int


class StopCommitment(NamedTuple):
    """One stop as the v2 journey lock commits to it. A plain value type rather than a
    TripStop row, so crypto/ stays free of db imports."""

    sequence: int
    precinct_id: uuid.UUID
    slot_time: datetime | None


# The payload_version a journey lock carries once it commits to the stops. v1 receipts have
# no such key; its absence is what identifies them.
TRIP_PAYLOAD_VERSION_V2 = 2


def canonical_json(payload: dict[str, Any]) -> str:
    """Compact JSON with sorted keys — the one serialisation every hash here uses."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _canonical_sha256(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def compute_snapshot_sha256(snapshot: dict[str, Any]) -> str:
    """SHA-256 of a stored PP manifest snapshot, in the lock's canonical form."""
    return _canonical_sha256(snapshot)


def _utc_iso(value: datetime | None) -> str | None:
    """UTC ISO-8601, so a request carrying +02:00 hashes the same as the UTC value
    Postgres returns at verification. A naive value is read as UTC — the same
    assumption asyncpg makes when it writes one to a timestamptz column."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def compute_trip_canonical_payload(
    *,
    trip_id: uuid.UUID,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    created_at: datetime,
    trip_type: str,
    pp_manifest: PPManifestKey | None,
    pp_manifest_snapshot_sha256: str | None,
    planned_departure_at: datetime | None,
    planned_arrival_at: datetime | None,
) -> dict[str, Any]:
    """Return the v1 canonical journey-lock payload, anchored and verified as one shape.

    Frozen: every receipt anchored before v2 was hashed from exactly this output. It
    commits to the origin and destination precincts but NOT to intermediate stops, so
    a trip created before v2 can have a middle stop changed without its lock breaking.
    New trips use compute_trip_canonical_payload_v2.

    Trailers are sorted so insertion order cannot change the hash; an empty list is
    valid (rigid trucks run without trailers).
    """
    return {
        "trip_id": str(trip_id),
        "driver_id": str(driver_id),
        "horse_id": str(horse_id),
        "trailers": sorted(str(t) for t in trailer_ids),
        "origin_precinct_id": str(origin_precinct_id),
        "destination_precinct_id": str(destination_precinct_id),
        "created_by_user_id": str(created_by_user_id),
        "created_at": _utc_iso(created_at),
        "trip_type": trip_type,
        "pp_manifest": pp_manifest._asdict() if pp_manifest is not None else None,
        "pp_manifest_snapshot_sha256": pp_manifest_snapshot_sha256,
        "planned_departure_at": _utc_iso(planned_departure_at),
        "planned_arrival_at": _utc_iso(planned_arrival_at),
    }


def compute_trip_canonical_payload_v2(
    *,
    trip_id: uuid.UUID,
    driver_id: uuid.UUID,
    horse_id: uuid.UUID,
    trailer_ids: list[uuid.UUID],
    origin_precinct_id: uuid.UUID,
    destination_precinct_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    created_at: datetime,
    trip_type: str,
    pp_manifest: PPManifestKey | None,
    pp_manifest_snapshot_sha256: str | None,
    planned_departure_at: datetime | None,
    planned_arrival_at: datetime | None,
    stops: Sequence[StopCommitment],
) -> dict[str, Any]:
    """The journey lock for new trips: every v1 field, plus `payload_version` and `stops`.

    `stops` is the route as (sequence, precinct_id, slot_time), sorted by sequence so the
    order the caller supplies them in cannot change the hash. slot_time is UTC-normalised
    like every other time here, or null when the stop has no slot.

    Deliberately NOT committed: consignments (their custody is what the phase ledger
    records, and the manifest snapshot hash already pins a manifest trip's cargo), the
    phase plan (derived from stops and consignments, and its rows are the ledger), and
    stop notes (free text for the driver, not a route parameter).
    """
    payload = compute_trip_canonical_payload(
        trip_id=trip_id, driver_id=driver_id, horse_id=horse_id, trailer_ids=trailer_ids,
        origin_precinct_id=origin_precinct_id, destination_precinct_id=destination_precinct_id,
        created_by_user_id=created_by_user_id, created_at=created_at, trip_type=trip_type,
        pp_manifest=pp_manifest, pp_manifest_snapshot_sha256=pp_manifest_snapshot_sha256,
        planned_departure_at=planned_departure_at, planned_arrival_at=planned_arrival_at,
    )
    payload["payload_version"] = TRIP_PAYLOAD_VERSION_V2
    payload["stops"] = [
        {
            "sequence": stop.sequence,
            "precinct_id": str(stop.precinct_id),
            "slot_time": _utc_iso(stop.slot_time),
        }
        for stop in sorted(stops, key=lambda s: s.sequence)
    ]
    return payload


def compute_journey_lock_hash(payload: dict[str, Any]) -> str:
    """64-char lowercase hex SHA-256 of a canonical journey-lock payload."""
    return _canonical_sha256(payload)
