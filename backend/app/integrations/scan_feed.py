"""Warehouse scan feed — the inbound interface for what was physically scanned.

PP is the system of record for what was *supposed* to be on the truck;
FreightProof is the system of record for what *actually* was. No API we can
reach exposes the observed set (PP's ecomService has one read method and our
account is Mode: Customer — see docs/parcel-perfect-integration-spec.md §B),
so the feed is specified here as an interface and mocked behind it,
mirroring get_pp_client():

    ScanFeed (Protocol)
    ├── MockScanFeed        ← demo: driven by the dev trigger panel
    └── <WmsScanFeed>       ← future: a PP depot API or the courier's WMS

Swap is one config flag (SCAN_FEED_USE_MOCK); no consumer changes.

Deliberately pull-shaped, not push, so a real WMS (also polled) doesn't
break the interface. Beyond staged barcodes, the feed also carries a
session-closed signal — see `is_scan_session_closed` for why a phase gates
on that, not barcode-set completeness.

Layering: integrations → config, mock_state only.
"""

import enum
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from app.core.config import settings
from app.integrations.mock_state import build_key, get_mock_state_store

logger = logging.getLogger(__name__)

# Redis key kind for scan state, distinct from staged PP state.
_SCAN_KEY_KIND = "scan"

# Separate key from staged barcodes, so closing a session can't rewrite the
# barcode payload if a dev-panel trigger fires out of order.
_SESSION_KEY_KIND = "scan-session"


class ScanDirection(str, enum.Enum):
    """Which way through the warehouse door the parcel went.

    Deliberately not in db/models/enums.py — never persisted as a column,
    and that file is read by every branch.
    """

    OUT = "out"   # scanned onto the truck at a pickup stop  → Parcel.pp_scan_out_at
    IN = "in"     # scanned off the truck at a delivery stop → Parcel.pp_scan_in_at


@dataclass(frozen=True)
class ScanEvent:
    """One barcode scanned at one stop, in one direction.

    Frozen: an observed scan is evidence, nothing downstream may edit it in
    place. `stop_reference`/`consignment_reference` are strings, not UUIDs
    — a real WMS keys on a waybill number and depot code, not our primary keys.
    """

    barcode: str
    direction: ScanDirection
    scanned_at: datetime
    consignment_reference: str
    stop_reference: str


@dataclass(frozen=True)
class ScanSessionQuery:
    """One "is this session closed?" question, so many can be asked at once.

    Frozen and hashable so callers can de-duplicate a batch before sending it.
    """

    consignment_reference: str
    stop_reference: str
    direction: ScanDirection


class ScanFeed(Protocol):
    """The contract orchestration depends on. Implementations are swapped by config."""

    async def poll_scans(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> list[ScanEvent]:
        """Return every scan the warehouse has recorded for this consignment at this stop."""
        ...

    async def is_scan_session_closed(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> bool:
        """Whether the warehouse has finished scanning this consignment at this stop.

        This, not set-completeness, gates a phase — a genuinely missing
        parcel would mean "every expected barcode seen" never becomes true,
        turning a short count into an indefinite block instead of a finding.
        """
        ...

    async def closed_sessions(self, queries: Sequence[ScanSessionQuery]) -> list[bool]:
        """Batched is_scan_session_closed: one answer per query, in order.

        The phase gate asks this per consignment per gated stop on every
        trip-detail read, so batching avoids a round trip per consignment.
        """
        ...


class MockScanFeed:
    """Redis-backed stub — no warehouse. SCAN_FEED_USE_MOCK=True selects it.

    stage_scans()/close_session() simulate the warehouse and are called only
    by the dev trigger panel; poll_scans()/is_scan_session_closed() are the
    production read paths orchestration touches.
    """

    def _key(self, consignment_reference: str, stop_reference: str, direction: ScanDirection) -> str:
        return build_key(_SCAN_KEY_KIND, consignment_reference, stop_reference, direction.value)

    def _session_key(
        self, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> str:
        return build_key(
            _SESSION_KEY_KIND, consignment_reference, stop_reference, direction.value,
        )

    async def stage_scans(
        self, *, consignment_reference: str, stop_reference: str,
        direction: ScanDirection, barcodes: list[str],
    ) -> None:
        """Record what the warehouse is about to report. Replaces any prior
        staging (an appending store would silently accumulate barcodes
        across mis-clicks)."""
        key = self._key(consignment_reference, stop_reference, direction)
        await get_mock_state_store().set_json(
            key,
            {
                "barcodes": barcodes,
                "scanned_at": datetime.now(UTC).isoformat(),
            },
        )
        logger.info(
            "MockScanFeed staged %d barcode(s) consignment=%s stop=%s direction=%s",
            len(barcodes), consignment_reference, stop_reference, direction.value,
        )

    async def poll_scans(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> list[ScanEvent]:
        key = self._key(consignment_reference, stop_reference, direction)
        staged = await get_mock_state_store().get_json(key)
        if staged is None:
            return []

        scanned_at = datetime.fromisoformat(staged["scanned_at"])
        barcodes: list[str] = staged["barcodes"]
        return [
            ScanEvent(
                barcode=barcode,
                direction=direction,
                scanned_at=scanned_at,
                consignment_reference=consignment_reference,
                stop_reference=stop_reference,
            )
            for barcode in barcodes
        ]

    async def close_session(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> None:
        """Simulate the warehouse operator closing the scan session. Dev panel only."""
        key = self._session_key(consignment_reference, stop_reference, direction)
        await get_mock_state_store().set_json(
            key, {"closed_at": datetime.now(UTC).isoformat()},
        )
        logger.info(
            "MockScanFeed closed session consignment=%s stop=%s direction=%s",
            consignment_reference, stop_reference, direction.value,
        )

    async def is_scan_session_closed(
        self, *, consignment_reference: str, stop_reference: str, direction: ScanDirection,
    ) -> bool:
        key = self._session_key(consignment_reference, stop_reference, direction)
        return await get_mock_state_store().get_json(key) is not None

    async def closed_sessions(self, queries: Sequence[ScanSessionQuery]) -> list[bool]:
        keys = [
            self._session_key(q.consignment_reference, q.stop_reference, q.direction)
            for q in queries
        ]
        states = await get_mock_state_store().get_many_json(keys)
        return [state is not None for state in states]


def get_scan_feed() -> ScanFeed:
    """Return the configured scan feed (mirrors get_pp_client())."""
    if settings.SCAN_FEED_USE_MOCK:
        return MockScanFeed()
    # No live feed exists (PP exposes no scan endpoint, no depot account).
    # Raising is honest — a silent mock fallback would let production
    # believe it had real scan data.
    raise NotImplementedError(
        "No live warehouse scan feed is implemented — set SCAN_FEED_USE_MOCK=true"
    )
