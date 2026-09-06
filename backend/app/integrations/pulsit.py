"""Pulsit vehicle-tracker client — position reads for a horse or trailer.

╔══════════════════════════════════════════════════════════════════════════════╗
║  THE API SHAPE IN THIS MODULE IS ASSUMED. IT IS NOT FROM PULSIT DOCUMENTATION.║
╚══════════════════════════════════════════════════════════════════════════════╝

Pulsit has supplied no API specification. Access is in motion rather than granted:
Bruce is introducing the team to Pulsit's commercial director around 8 September,
with Ciaran as the named point of contact for credentials
(docs/iteration3_plan.md §9). That is after this sprint, so the integration is
built now behind PULSE_USE_MOCK and must not wait on the introduction.

Because the shape is guessed, every guess is quarantined in exactly two places:

    _parse_position()          how one position object is read
    the _PULSIT_* constants    the path, the query parameter, the field names

When the real specification arrives, those are the only things that change.
`PulsitFix` — the structure callers actually consume — is ours, not Pulsit's, and
is designed not to move. Raw Pulsit JSON never leaves this module.

Assumption inventory, so a reviewer can audit the guess rather than discover it:

  * Transport is HTTPS + JSON, read via GET.
  * A bearer token in the Authorization header is the credential
    (PULSE_API_KEY holds it; PULSE_API_URL is the base).
  * Positions are addressed by the tracker's device id — the one thing we do know,
    because vehicles.pulsit_device_id is NOT NULL and unique per organisation.
  * Many device ids can be read in one call. FP-195 needs a fix per trailer at a
    single phase moment, so a per-device round trip is the wrong default shape.
  * A device with no current fix is reported as a null position rather than an
    error, and an unrecognised device is simply absent from the response.

Layering: integrations → config, mock_state. Never imports from api/ or orchestration/.

Scope note — this module answers "where is this device", nothing more. It does not
compare a fix to a geofence (FP-68 owns that verdict), does not write to the
database (FP-143/FP-195), and raises no exceptions of its own on the read path
(FP-145 owns GPS_MISMATCH).

Seam for FP-197 ("Move the truck"): the dev-only HTTP endpoint that mutates mock
state belongs in api/v1/endpoints/dev_triggers.py and should call
MockPulsitClient.stage_position() / .stage_no_fix() — the same way the PP trigger
calls MockParcelPerfectClient.stage_waybill_override(). Nothing else needs to exist.

Design note, not a build — recorded here because this module is where it would land:
Pulsit hardware also produces discrete events, notably the rear-door geofence
unlock, and Pulsit runs cab and door cameras whose footage could be pulled around
an exception window. Both are better corroboration than a position sample, because
they are acts a driver's phone cannot fabricate. Neither is in FP-87. The natural
seam for them is a sibling method on the PulsitClient Protocol below, reading the
same base URL and credential, with its own mock-state kind.
"""

import logging
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


# ---------------------------------------------------------------------------
# Errors
#
# There is exactly one, and it is not raised on any read path. A missing tracker
# reading must never break a handshake — the driver is standing at a gate and the
# evidence capture has to complete whether or not Pulsit answers. Absence is
# therefore modelled as a PulsitFix carrying a status, not as an exception.
# ---------------------------------------------------------------------------


class PulsitUnsupportedError(Exception):
    """Raised when an operation cannot be honoured in the current configuration.

    Only staging raises it: staging mock state while pointed at live Pulsit would
    do nothing at all, and a dev trigger that silently does nothing is worse in a
    demo than one that fails loudly. Mirrors PPUnsupportedError.
    """


# ---------------------------------------------------------------------------
# The fix structure callers consume — FP-68 and FP-143 both depend on this
# ---------------------------------------------------------------------------


class PulsitFixSource(str, Enum):
    """Where a fix came from, so evidence can never silently claim to be real.

    Carried on every fix rather than inferred from config at the point of use: a
    caller reading a stored fix months later cannot re-read the flag that was set
    when it was taken.
    """

    MOCK = "mock"
    LIVE = "live"


class PulsitFixStatus(str, Enum):
    """Why a fix does or does not carry a position.

    Three distinct failures rather than one, because they mean different things to
    whoever reads the evidence: an unknown device is a fleet-data bug worth fixing,
    no fix is a tracker that is dark right now, and unavailable is our side failing
    to reach Pulsit. Collapsing them would make all three look like "no GPS".
    """

    OK = "ok"
    # Pulsit knows the device but reports no current position (unit dark, no signal).
    NO_FIX = "no_fix"
    # Pulsit does not recognise the device id — the fleet record and the tracker
    # estate disagree.
    UNKNOWN_DEVICE = "unknown_device"
    # We could not get an answer: timeout, transport failure, or a response we
    # could not read. Says nothing about the vehicle.
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class PulsitFix:
    """One tracker's position at one moment, in FreightProof's own terms.

    Frozen: a position reading is evidence, and nothing downstream may edit it in
    place. Mirrors ScanEvent in scan_feed.py for the same reason.

    Always returned, never None. A caller asking about a device always gets a row
    back naming that device, so "which trailer had no fix" is answerable without
    the caller zipping results back against its own request list.

    lat/lng are Decimal, not float: they land in Numeric(10,7) columns
    (trailer_gps_snapshots.lat/lng, phase_events.horse_gps_lat/lng) and are compared
    against Precinct.latitude/longitude, which are already Decimal. Parsing straight
    to Decimal keeps binary-float error out of a value that is evidence.

    Consumers:
      FP-68  — map to geofence_service.TrackerFix(lat=..., lng=...) when
               has_position is true, else pass None. That module deliberately owns
               a narrower shape and takes Optional[TrackerFix]; this maps onto it,
               not the reverse.
      FP-143 — persists lat/lng; FP-195 additionally persists device_id and
               fixed_at into trailer_gps_snapshots.
    """

    device_id: str
    status: PulsitFixStatus
    source: PulsitFixSource
    # None whenever status is not OK. Never defaulted to 0.0 — that is a real
    # coordinate in the Gulf of Guinea, not an absence.
    lat: Optional[Decimal]
    lng: Optional[Decimal]
    # When the tracker took the reading, per Pulsit — not when we asked. The two
    # differ by however stale the unit's last report is, and only the former is
    # evidence of where the vehicle was.
    fixed_at: Optional[datetime]

    @property
    def has_position(self) -> bool:
        """Whether this fix carries usable coordinates.

        The one check callers should make. Reading `status == OK` works too, but
        this keeps a caller from having to know which statuses imply coordinates.
        """
        return self.status is PulsitFixStatus.OK and self.lat is not None and self.lng is not None


def _absent_fix(
    device_id: str, status: PulsitFixStatus, source: PulsitFixSource
) -> PulsitFix:
    """Build a positionless fix. One constructor so every absence looks identical."""
    return PulsitFix(
        device_id=device_id, status=status, source=source, lat=None, lng=None, fixed_at=None
    )


# ---------------------------------------------------------------------------
# The contract orchestration depends on
# ---------------------------------------------------------------------------


class PulsitClient(Protocol):
    """The Pulsit surface FP-68 and FP-143 depend on. Swapped by config.

    A Protocol rather than a base class, matching ScanFeed: it lets a test pass a
    hand-built stub without importing httpx or Redis, and it keeps the live and
    mock implementations from sharing inherited behaviour that only one of them
    should have.
    """

    async def get_positions(self, device_ids: Sequence[str]) -> list[PulsitFix]:
        """Return one fix per requested device id, in the order requested.

        The batch form is the contract, not a convenience: FP-195 writes a snapshot
        per trailer at a single phase moment, so a trip with four trailers must cost
        one call, not four. Duplicate ids in, duplicate fixes out — de-duplication
        is the caller's business, and silently collapsing them would break the
        positional correspondence this promises.
        """
        ...

    async def get_position(self, device_id: str) -> PulsitFix:
        """Return the fix for one device. Convenience over get_positions."""
        ...


# ---------------------------------------------------------------------------
# Mock fixtures
# ---------------------------------------------------------------------------

# Every seeded demo tracker starts parked at the Cape Town depot — the origin
# precinct of the seeded trips (scripts/seed_demo.py:_PRECINCTS). Deliberate: a
# gate-in geofence check at origin then confirms with nothing staged, so the happy
# path demos without setup, and FP-197's "move the truck" trigger is the only thing
# that can produce a mismatch. A fixture that started out of position would make
# every demo open on a failure nobody triggered.
_CPT_DEPOT_LAT = Decimal("-33.9249")
_CPT_DEPOT_LNG = Decimal("18.4241")

# Keyed to scripts/seed_demo.py:_VEHICLES. Anything outside this library reads as
# UNKNOWN_DEVICE, mirroring the PP mock raising not-found for an unregistered
# waybill: Pulsit genuinely would not know a device id we invented, and the
# fail-closed path must behave the same in dev, CI and against live Pulsit.
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

# Field names inside the staged JSON blob. Internal to this module — this is our
# own storage format, not Pulsit's.
_STAGED_STATUS = "status"
_STAGED_LAT = "lat"
_STAGED_LNG = "lng"
_STAGED_FIXED_AT = "fixed_at"


class MockPulsitClient:
    """Redis-backed stub — no network. PULSE_USE_MOCK=True selects it.

    Redis rather than a module-level dict for the reason mock_state.py exists: the
    API and the Celery worker are separate processes, so a position staged in one
    would be invisible to the other, and "move the truck, then watch the next poll
    notice" could never work in memory.

    stage_position() and stage_no_fix() are the simulated outside world and are
    called only by the dev trigger panel (FP-197). get_positions() is the production
    read path and is all that orchestration ever touches — the same split as
    MockScanFeed.
    """

    def _key(self, device_id: str) -> str:
        return build_key(_PULSIT_KEY_KIND, device_id)

    def _require_mock_mode(self) -> None:
        """Guard every staging call. Mirrors stage_waybill_override's check."""
        if not settings.PULSE_USE_MOCK:
            raise PulsitUnsupportedError(
                "Cannot stage a tracker position while PULSE_USE_MOCK is false"
            )

    async def stage_position(
        self, device_id: str, lat: Decimal, lng: Decimal, *, fixed_at: Optional[datetime] = None
    ) -> None:
        """Move a tracker. Replaces any previously staged state for this device.

        Replace rather than merge: a position is a single whole fact, and re-staging
        is how a demo is corrected after a mis-click. Mirrors MockScanFeed.stage_scans,
        and deliberately unlike the PP override layer, which is additive because a
        waybill accumulates independent field edits.

        `fixed_at` defaults to now, because staging *is* the moment the truck moved.
        It is accepted explicitly so a test can pin a timestamp without patching a clock.

        This is the entry point FP-197's dev endpoint should call.

        Raises:
            PulsitUnsupportedError: PULSE_USE_MOCK is false.
        """
        self._require_mock_mode()
        await get_mock_state_store().set_json(
            self._key(device_id),
            {
                _STAGED_STATUS: PulsitFixStatus.OK.value,
                # Stored as strings: JSON has one numeric type and it is a float,
                # so round-tripping a Decimal through it would quietly lose the
                # precision the Numeric(10,7) columns are there to keep.
                _STAGED_LAT: str(lat),
                _STAGED_LNG: str(lng),
                _STAGED_FIXED_AT: (fixed_at or datetime.now(UTC)).isoformat(),
            },
        )
        logger.info("MockPulsitClient staged position device=%s", device_id)

    async def stage_no_fix(self, device_id: str) -> None:
        """Take a tracker dark — it stops reporting a position but stays known.

        The other half of the state layer, and a distinct demo from staging a wrong
        position: this is the unit losing signal, not the vehicle being elsewhere.
        FP-143 has to store a null rather than a wrong coordinate for it.

        Raises:
            PulsitUnsupportedError: PULSE_USE_MOCK is false.
        """
        self._require_mock_mode()
        await get_mock_state_store().set_json(
            self._key(device_id), {_STAGED_STATUS: PulsitFixStatus.NO_FIX.value}
        )
        logger.info("MockPulsitClient staged no-fix device=%s", device_id)

    def _fix_from_staged(self, device_id: str, staged: dict[str, Any]) -> PulsitFix:
        """Rebuild a fix from staged state. Unreadable state reads as no fix.

        Corrupt staged state is a bug in a writer, not a reason to fail a demo — the
        same stance mock_state.py takes on undecodable JSON. Logged loudly so the
        writer gets fixed, then degraded to the honest answer.
        """
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
        # One batched read for the whole request, not a read per device: the store
        # opens a Redis connection per call, so a four-trailer phase would otherwise
        # cost four connections. Same reason closed_sessions() exists on ScanFeed.
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
                    # Read time, not a frozen fixture timestamp: a position is a
                    # claim about *now*, and a hardcoded date would make every
                    # unstaged demo read look hours stale.
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

# Pulsit publishes no SLA — there is no specification at all. 15 s matches the PP
# client's bound, which was itself set to our Hedera cap, so one number governs how
# long any external call may hold a handshake open.
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

    Cannot be exercised end-to-end: no credentials exist yet. It is built now so
    that arriving credentials are a config change rather than a rewrite, and it is
    covered by unit tests against hand-built fixtures so the parsing and the failure
    paths are at least proven against the shape we are assuming.

    No token cache and no auth handshake, unlike the PP client: a bearer key held in
    config needs no exchange. If Pulsit turns out to issue short-lived tokens, that
    is a second method here, not a change to anything above.
    """

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {settings.PULSE_API_KEY}"}

    async def get_positions(self, device_ids: Sequence[str]) -> list[PulsitFix]:
        if not device_ids:
            return []

        if not settings.PULSE_API_URL:
            # Fail loudly in the log, honestly in the return value. Reached only by
            # misconfiguration — PULSE_USE_MOCK=false with no URL set — and a
            # handshake must still complete, so this cannot raise.
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
            # A slow tracker API must not hold a driver at a gate. Warning, not
            # error: a timeout is an expected condition on a mobile-network-backed
            # telematics service, not a defect.
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
            # httpx.HTTPError covers transport failures; ValueError covers a body
            # that is not JSON at all (httpx raises json.JSONDecodeError, a subclass).
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

        A device we asked about but that is absent from the response reads as
        UNKNOWN_DEVICE — under the assumed shape, that is how Pulsit says it has no
        such tracker. If that assumption is wrong, this is the one place it is wrong.
        """
        raw_positions = body.get(_PULSIT_FIELD_POSITIONS) if isinstance(body, dict) else None
        if not isinstance(raw_positions, list):
            # The envelope itself is not what we expect, so nothing in it can be
            # trusted — this says nothing about any individual vehicle.
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


def _parse_position(device_id: str, entry: dict[str, Any]) -> PulsitFix:
    """Map ONE assumed Pulsit position object onto PulsitFix.

    THIS FUNCTION IS THE ASSUMPTION. When Pulsit's real specification arrives, this
    is the change — everything above and below it is shape-independent.

    Assumed entry:
        {"device_id": "...", "latitude": -33.9249, "longitude": 18.4241,
         "timestamp": "2026-09-04T08:12:03Z"}

    A null latitude or longitude is read as the tracker having no current fix.
    Anything unreadable is UNAVAILABLE for this device only — one malformed entry
    must not discard the other trailers in the same response.
    """
    lat_raw = entry.get(_PULSIT_FIELD_LAT)
    lng_raw = entry.get(_PULSIT_FIELD_LNG)
    if lat_raw is None or lng_raw is None:
        return _absent_fix(device_id, PulsitFixStatus.NO_FIX, PulsitFixSource.LIVE)

    try:
        # str() first: JSON numbers arrive as floats, and Decimal(float) preserves
        # the binary approximation rather than the decimal value that was sent.
        lat = Decimal(str(lat_raw))
        lng = Decimal(str(lng_raw))
        fixed_at = datetime.fromisoformat(str(entry[_PULSIT_FIELD_TIMESTAMP]))
    except (KeyError, TypeError, ValueError, InvalidOperation):
        logger.error(
            "Malformed Pulsit position entry for device=%s — treating as unavailable", device_id
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


def get_pulsit_client() -> PulsitClient:
    """Return the configured Pulsit client. Mirrors get_pp_client() and get_scan_feed().

    Callers depend on this rather than instantiating a client directly, so that the
    day credentials arrive, flipping PULSE_USE_MOCK to false is the entire change.
    """
    if settings.PULSE_USE_MOCK:
        return MockPulsitClient()
    return LivePulsitClient()
