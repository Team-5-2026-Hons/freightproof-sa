"""Pulsit vehicle-tracker client — position reads for a horse or trailer.

THE API SHAPE IN THIS MODULE IS ASSUMED, NOT FROM PULSIT DOCUMENTATION —
credentials aren't in hand yet (docs/iteration3_plan.md §9), so this is built
behind PULSE_USE_MOCK. Every guess is quarantined in `_parse_position()` and
the `_PULSIT_*` constants; `PulsitFix` (what callers consume) is ours and
stable. Raw Pulsit JSON never leaves this module.

Assumptions: HTTPS+JSON over GET; bearer token auth (PULSE_API_KEY/URL);
addressed by device id (vehicles.pulsit_device_id, unique per org); many
device ids readable in one call (FP-195 needs one fix per trailer per phase
moment); a dark tracker returns a null position, an unrecognised device is
simply absent from the response.

Layering: integrations → config, mock_state only.

Scope: answers "where is this device", nothing more — no geofence
comparison (FP-68), no DB write (FP-143/FP-195), no exceptions on the read
path (FP-145 owns GPS_MISMATCH).

FP-197 ("Move the truck") seam: the dev-only trigger endpoint should call
MockPulsitClient.stage_position()/.stage_no_fix(), mirroring the PP trigger.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Optional, Protocol

import httpx

from app.core.config import settings
from app.integrations.mock_state import build_key, get_mock_state_store

logger = logging.getLogger(__name__)


# Not raised on any read path — a missing tracker reading must never break a
# handshake, so absence is modelled as a PulsitFix status, not an exception.


class PulsitUnsupportedError(Exception):
    """Raised only when staging mock state while pointed at live Pulsit
    (mirrors PPUnsupportedError) — fails loudly rather than silently no-op'ing."""


class PulsitFixSource(str, Enum):
    """Where a fix came from; carried on every fix (not inferred from config)
    so a caller reading a stored fix later can't lose the provenance flag."""

    MOCK = "mock"
    LIVE = "live"


class PulsitFixStatus(str, Enum):
    """Why a fix does or does not carry a position — kept distinct since each
    means something different to whoever reads the evidence."""

    OK = "ok"
    # Pulsit knows the device but reports no current position (dark, no signal).
    NO_FIX = "no_fix"
    # Pulsit does not recognise the device id — fleet record vs tracker estate disagree.
    UNKNOWN_DEVICE = "unknown_device"
    # We could not get an answer (timeout/transport/unreadable). Says nothing
    # about the vehicle.
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class PulsitFix:
    """One tracker's position at one moment, in FreightProof's own terms.

    Frozen: a position reading is evidence and nothing downstream may edit it
    in place (mirrors ScanEvent). Always returned, never None, so a caller
    can tell which requested device had no fix.

    lat/lng are Decimal, not float, since they land in Numeric(10,7) columns
    compared against Precinct.latitude/longitude (also Decimal) — keeps
    binary-float error out of evidence.

    Consumers: FP-68 maps this onto geofence_service.TrackerFix; FP-143/195
    persist lat/lng/device_id/fixed_at into trailer_gps_snapshots.
    """

    device_id: str
    status: PulsitFixStatus
    source: PulsitFixSource
    # None whenever status is not OK — never defaulted to 0.0, a real coordinate.
    lat: Optional[Decimal]
    lng: Optional[Decimal]
    # When the tracker took the reading, per Pulsit — not when we asked.
    fixed_at: Optional[datetime]

    @property
    def has_position(self) -> bool:
        """Whether this fix carries usable coordinates — the one check callers should make."""
        return self.status is PulsitFixStatus.OK and self.lat is not None and self.lng is not None


def _absent_fix(
    device_id: str, status: PulsitFixStatus, source: PulsitFixSource
) -> PulsitFix:
    """Build a positionless fix. One constructor so every absence looks identical."""
    return PulsitFix(
        device_id=device_id, status=status, source=source, lat=None, lng=None, fixed_at=None
    )


class PulsitClient(Protocol):
    """The Pulsit surface FP-68 and FP-143 depend on. Swapped by config.

    A Protocol (matching ScanFeed) so a test can pass a hand-built stub
    without importing httpx or Redis.
    """

    async def get_positions(self, device_ids: Sequence[str]) -> list[PulsitFix]:
        """Return one fix per requested device id, in the order requested.

        Batch is the contract, not a convenience: FP-195 needs one call per
        phase moment, not one per trailer. Duplicate ids in, duplicate fixes
        out — de-duplication is the caller's business.
        """
        ...

    async def get_position(self, device_id: str) -> PulsitFix:
        """Return the fix for one device. Convenience over get_positions."""
        ...


# ---------------------------------------------------------------------------
# Mock fixtures
# ---------------------------------------------------------------------------

# Every seeded demo tracker starts parked at the Cape Town depot (origin
# precinct of the seeded trips) so the happy path demos without setup; only
# FP-197's "move the truck" trigger produces a mismatch.
_CPT_DEPOT_LAT = Decimal("-33.9249")
_CPT_DEPOT_LNG = Decimal("18.4241")

# Keyed to scripts/seed_demo.py:_VEHICLES. Anything outside this library
# reads as UNKNOWN_DEVICE, matching how live Pulsit would treat an
# unregistered device id.
MOCK_DEVICE_POSITIONS: dict[str, tuple[Decimal, Decimal]] = {
    "PLT-HORSE-001": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
    "PLT-HORSE-002": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
    "PLT-HORSE-003": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
    "PLT-TRAILER-001": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
    "PLT-TRAILER-002": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
    "PLT-TRAILER-003": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
    "PLT-TRAILER-004": (_CPT_DEPOT_LAT, _CPT_DEPOT_LNG),
}


# ---------------------------------------------------------------------------
# Mock client and its Redis state layer (FP-187)
# ---------------------------------------------------------------------------

# Redis key kind for staged tracker positions, distinct from staged PP and scan state.
_PULSIT_KEY_KIND = "pulsit"

# Field names inside the staged JSON blob — our own storage format, not Pulsit's.
_STAGED_STATUS = "status"
_STAGED_LAT = "lat"
_STAGED_LNG = "lng"
_STAGED_FIXED_AT = "fixed_at"


class MockPulsitClient:
    """Redis-backed stub — no network. PULSE_USE_MOCK=True selects it.

    Redis rather than a module dict: API and Celery worker are separate
    processes and both need to see a staged position. Keys include the
    organisation so tenants can't share staged state for the same device id.

    stage_position()/stage_no_fix() are the simulated outside world, called
    only by the dev trigger panel (FP-197); get_positions() is the
    production read path — same split as MockScanFeed.
    """

    def __init__(self, organization_id: uuid.UUID) -> None:
        self._organization_id = organization_id

    def _key(self, device_id: str) -> str:
        return build_key(_PULSIT_KEY_KIND, str(self._organization_id), device_id)

    def _require_mock_mode(self) -> None:
        """Guard every staging call. Mirrors stage_waybill_override's check."""
        if not settings.PULSE_USE_MOCK:
            raise PulsitUnsupportedError(
                "Cannot stage a tracker position while PULSE_USE_MOCK is false"
            )

    async def stage_position(
        self, device_id: str, lat: Decimal, lng: Decimal, *, fixed_at: Optional[datetime] = None
    ) -> None:
        """Move a tracker. Replaces any previously staged state for this device
        (a position is one whole fact, unlike PP's additive field-edit overrides).

        `fixed_at` defaults to now (staging *is* the moment the truck moved),
        accepted explicitly so a test can pin it without patching a clock.
        This is the entry point FP-197's dev endpoint should call.

        Raises:
            PulsitUnsupportedError: PULSE_USE_MOCK is false.
        """
        self._require_mock_mode()
        await get_mock_state_store().set_json(
            self._key(device_id),
            {
                _STAGED_STATUS: PulsitFixStatus.OK.value,
                # Stored as strings: round-tripping Decimal through JSON's
                # float would lose the precision Numeric(10,7) needs.
                _STAGED_LAT: str(lat),
                _STAGED_LNG: str(lng),
                _STAGED_FIXED_AT: (fixed_at or datetime.now(UTC)).isoformat(),
            },
        )
        logger.info("MockPulsitClient staged position device=%s", device_id)

    async def stage_no_fix(self, device_id: str) -> None:
        """Take a tracker dark: stops reporting a position but stays known
        (unit losing signal, not the vehicle being elsewhere).

        Raises:
            PulsitUnsupportedError: PULSE_USE_MOCK is false.
        """
        self._require_mock_mode()
        await get_mock_state_store().set_json(
            self._key(device_id), {_STAGED_STATUS: PulsitFixStatus.NO_FIX.value}
        )
        logger.info("MockPulsitClient staged no-fix device=%s", device_id)

    def _fix_from_staged(self, device_id: str, staged: dict[str, Any]) -> PulsitFix:
        """Rebuild a fix from staged state; unreadable state degrades to no fix
        (a writer bug, logged loudly, not a reason to fail a demo)."""
        if staged.get(_STAGED_STATUS) != PulsitFixStatus.OK.value:
            return _absent_fix(device_id, PulsitFixStatus.NO_FIX, PulsitFixSource.MOCK)
        try:
            return PulsitFix(
                device_id=device_id,
                status=PulsitFixStatus.OK,
                source=PulsitFixSource.MOCK,
                lat=Decimal(str(staged[_STAGED_LAT])),
                lng=Decimal(str(staged[_STAGED_LNG])),
                fixed_at=datetime.fromisoformat(str(staged[_STAGED_FIXED_AT])),
            )
        except (KeyError, InvalidOperation, ValueError):
            logger.error(
                "Unreadable staged Pulsit state for device=%s — treating as no fix", device_id
            )
            return _absent_fix(device_id, PulsitFixStatus.NO_FIX, PulsitFixSource.MOCK)

    async def get_positions(self, device_ids: Sequence[str]) -> list[PulsitFix]:
        if not device_ids:
            return []

        store = get_mock_state_store()
        # One batched read for the whole request, not a read per device — the
        # store opens a Redis connection per call.
        staged_states = await store.get_many_json([self._key(d) for d in device_ids])

        fixes: list[PulsitFix] = []
        for device_id, staged in zip(device_ids, staged_states, strict=True):
            if staged is not None:
                fixes.append(self._fix_from_staged(device_id, staged))
                continue

            fixture = MOCK_DEVICE_POSITIONS.get(device_id)
            if fixture is None:
                logger.info("MockPulsitClient unknown device=%s", device_id)
                fixes.append(
                    _absent_fix(device_id, PulsitFixStatus.UNKNOWN_DEVICE, PulsitFixSource.MOCK)
                )
                continue

            lat, lng = fixture
            fixes.append(
                PulsitFix(
                    device_id=device_id,
                    status=PulsitFixStatus.OK,
                    source=PulsitFixSource.MOCK,
                    lat=lat,
                    lng=lng,
                    # Read time, not a fixed fixture timestamp — a position is
                    # a claim about *now*.
                    fixed_at=datetime.now(UTC),
                )
            )
        return fixes

    async def get_position(self, device_id: str) -> PulsitFix:
        return (await self.get_positions([device_id]))[0]


# ---------------------------------------------------------------------------
# Live client
#
# Everything below encodes the assumed API shape. See the module docstring.
# ---------------------------------------------------------------------------

# No published Pulsit SLA; 15s matches the PP client's bound (itself set to
# our Hedera cap) so one number governs how long any external call may hold
# a handshake open.
_PULSIT_TIMEOUT_SECONDS: float = 15.0

# ASSUMED request shape. Changing these is how this module is pointed at the real API.
_PULSIT_POSITIONS_PATH = "/positions"
_PULSIT_DEVICE_IDS_PARAM = "device_ids"
_PULSIT_DEVICE_IDS_SEPARATOR = ","

# ASSUMED response field names.
_PULSIT_FIELD_POSITIONS = "positions"
_PULSIT_FIELD_DEVICE_ID = "device_id"
_PULSIT_FIELD_LAT = "latitude"
_PULSIT_FIELD_LNG = "longitude"
_PULSIT_FIELD_TIMESTAMP = "timestamp"


class LivePulsitClient:
    """Async client for the Pulsit position API, built to the assumed shape.

    Cannot be exercised end-to-end (no credentials yet); built now so
    arriving credentials are a config change, not a rewrite, and covered by
    unit tests against hand-built fixtures.

    No token cache/auth handshake, unlike the PP client: a bearer key held
    in config needs no exchange.
    """

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {settings.PULSE_API_KEY}"}

    async def get_positions(self, device_ids: Sequence[str]) -> list[PulsitFix]:
        if not device_ids:
            return []

        if not settings.PULSE_API_URL:
            # Misconfiguration (PULSE_USE_MOCK=false, no URL) — a handshake
            # must still complete, so this cannot raise.
            logger.error("PULSE_API_URL is not configured; cannot read tracker positions")
            return self._all_unavailable(device_ids)

        url = f"{settings.PULSE_API_URL.rstrip('/')}{_PULSIT_POSITIONS_PATH}"
        params = {
            _PULSIT_DEVICE_IDS_PARAM: _PULSIT_DEVICE_IDS_SEPARATOR.join(device_ids)
        }

        try:
            async with httpx.AsyncClient(timeout=_PULSIT_TIMEOUT_SECONDS) as client:
                response = await client.get(url, params=params, headers=self._headers())
            response.raise_for_status()
            body: dict[str, Any] = response.json()
        except httpx.TimeoutException:
            # Warning, not error: a timeout is an expected condition on a
            # mobile-network telematics service, not a defect.
            logger.warning(
                "Pulsit position request timed out after %ss for %d device(s)",
                _PULSIT_TIMEOUT_SECONDS,
                len(device_ids),
            )
            return self._all_unavailable(device_ids)
        except httpx.HTTPStatusError as exc:
            logger.error("Pulsit position request failed with HTTP %s", exc.response.status_code)
            return self._all_unavailable(device_ids)
        except (httpx.HTTPError, ValueError) as exc:
            # ValueError covers a non-JSON body (json.JSONDecodeError is a subclass).
            logger.error("Pulsit position request could not be completed: %s", exc)
            return self._all_unavailable(device_ids)

        return self._parse_positions_response(body, device_ids)

    @staticmethod
    def _all_unavailable(device_ids: Sequence[str]) -> list[PulsitFix]:
        """One UNAVAILABLE fix per requested device, preserving order."""
        return [
            _absent_fix(device_id, PulsitFixStatus.UNAVAILABLE, PulsitFixSource.LIVE)
            for device_id in device_ids
        ]

    def _parse_positions_response(
        self, body: dict[str, Any], device_ids: Sequence[str]
    ) -> list[PulsitFix]:
        """Index the response by device id and answer each requested device in order.

        A device absent from the response reads as UNKNOWN_DEVICE under the
        assumed shape — the one place that assumption would be wrong.
        """
        raw_positions = body.get(_PULSIT_FIELD_POSITIONS) if isinstance(body, dict) else None
        if not isinstance(raw_positions, list):
            # Envelope itself isn't what we expect — says nothing about any
            # individual vehicle.
            logger.error(
                "Pulsit response missing a %r list; treating all %d device(s) as unavailable",
                _PULSIT_FIELD_POSITIONS,
                len(device_ids),
            )
            return self._all_unavailable(device_ids)

        by_device: dict[str, Any] = {}
        for entry in raw_positions:
            if isinstance(entry, dict) and isinstance(entry.get(_PULSIT_FIELD_DEVICE_ID), str):
                by_device[entry[_PULSIT_FIELD_DEVICE_ID]] = entry

        fixes: list[PulsitFix] = []
        for device_id in device_ids:
            entry = by_device.get(device_id)
            if entry is None:
                logger.info("Pulsit returned no entry for device=%s", device_id)
                fixes.append(
                    _absent_fix(device_id, PulsitFixStatus.UNKNOWN_DEVICE, PulsitFixSource.LIVE)
                )
                continue
            fixes.append(_parse_position(device_id, entry))
        return fixes

    async def get_position(self, device_id: str) -> PulsitFix:
        return (await self.get_positions([device_id]))[0]


# Valid coordinate ranges. An impossible coordinate must never become a
# stored fix, so this is checked here rather than left to whatever reads
# the row later.
_MIN_LATITUDE, _MAX_LATITUDE = -90, 90
_MIN_LONGITUDE, _MAX_LONGITUDE = -180, 180


def _is_usable_coordinate(value: Decimal, *, minimum: int, maximum: int) -> bool:
    """A coordinate this module will accept as evidence: finite and in range.

    `is_finite()` rejects NaN/Infinity, which Decimal can represent (unlike a
    plain float `==` check); either must become UNAVAILABLE rather than a
    stored coordinate that later geofence maths would choke on.
    """
    return value.is_finite() and minimum <= value <= maximum


def _parse_position(device_id: str, entry: dict[str, Any]) -> PulsitFix:
    """Map ONE assumed Pulsit position object onto PulsitFix.

    THIS FUNCTION IS THE ASSUMPTION — when Pulsit's real spec arrives, this
    is the change; everything else is shape-independent.

    Assumed entry:
        {"device_id": "...", "latitude": -33.9249, "longitude": 18.4241,
         "timestamp": "2026-09-04T08:12:03Z"}

    A null lat/lng reads as no current fix. Anything else unreadable
    (out-of-range coordinate, timestamp with no UTC offset) is UNAVAILABLE
    for this device only, so one malformed entry doesn't discard the rest
    of the response. A naive timestamp specifically must not become
    evidence — corroboration_service compares fixed_at against the driver's
    own aware capture instant, and a naive value would silently compare as UTC.
    """
    lat_raw = entry.get(_PULSIT_FIELD_LAT)
    lng_raw = entry.get(_PULSIT_FIELD_LNG)
    if lat_raw is None or lng_raw is None:
        return _absent_fix(device_id, PulsitFixStatus.NO_FIX, PulsitFixSource.LIVE)

    try:
        # str() first: Decimal(float) would preserve the binary approximation
        # rather than the decimal value JSON sent.
        lat = Decimal(str(lat_raw))
        lng = Decimal(str(lng_raw))
        fixed_at = datetime.fromisoformat(str(entry[_PULSIT_FIELD_TIMESTAMP]))
    except (KeyError, TypeError, ValueError, InvalidOperation):
        logger.error(
            "Malformed Pulsit position entry for device=%s — treating as unavailable", device_id
        )
        return _absent_fix(device_id, PulsitFixStatus.UNAVAILABLE, PulsitFixSource.LIVE)

    if not _is_usable_coordinate(lat, minimum=_MIN_LATITUDE, maximum=_MAX_LATITUDE) or not (
        _is_usable_coordinate(lng, minimum=_MIN_LONGITUDE, maximum=_MAX_LONGITUDE)
    ):
        logger.error(
            "Pulsit position entry for device=%s has a non-finite or out-of-range "
            "coordinate — treating as unavailable", device_id,
        )
        return _absent_fix(device_id, PulsitFixStatus.UNAVAILABLE, PulsitFixSource.LIVE)

    if fixed_at.tzinfo is None:
        logger.error(
            "Pulsit position entry for device=%s has a timezone-naive timestamp — "
            "treating as unavailable rather than guessing its offset", device_id,
        )
        return _absent_fix(device_id, PulsitFixStatus.UNAVAILABLE, PulsitFixSource.LIVE)

    return PulsitFix(
        device_id=device_id,
        status=PulsitFixStatus.OK,
        source=PulsitFixSource.LIVE,
        lat=lat,
        lng=lng,
        fixed_at=fixed_at,
    )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_pulsit_client(*, organization_id: uuid.UUID) -> PulsitClient:
    """Return the configured Pulsit client (mirrors get_pp_client()/get_scan_feed()).

    Callers depend on this rather than instantiating directly, so flipping
    PULSE_USE_MOCK to false is the entire change once credentials arrive.
    """
    if settings.PULSE_USE_MOCK:
        return MockPulsitClient(organization_id)
    return LivePulsitClient()
