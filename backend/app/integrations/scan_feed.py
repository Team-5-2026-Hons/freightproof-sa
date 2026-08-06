"""Warehouse scan feed — the inbound interface for what was physically scanned.

Parcel Perfect is the system of record for what was *supposed* to be on the truck;
FreightProof is the system of record for what *actually* was. PP supplies the
expected set at parcel grain (tracks[], already persisted as Parcel rows). The
observed set has to come from the warehouse's own scanning system, and no API we
can reach exposes it — PP's ecomService has exactly one read method
(getSingleWaybill) and our account is Mode: Customer, which cannot manifest or
dispatch. See docs/parcel-perfect-integration-spec.md §B.

So the feed is specified here as an interface and mocked behind it, mirroring
get_pp_client():

    ScanFeed (Protocol)
    ├── MockScanFeed        ← demo: driven by the dev trigger panel
    └── <WmsScanFeed>       ← future: a PP depot API or the courier's WMS

The swap is one config flag (SCAN_FEED_USE_MOCK), and no consumer changes.

The feed is deliberately PULL-shaped, not push-shaped: a real WMS integration
would be polled exactly like PP is, so a push interface would not survive the
swap. MockScanFeed holds a staged script that the dev panel writes and poll_scans
reads back.

Beyond staged barcodes, the feed also carries a session-closed signal: whether the
warehouse operator has finished scanning this consignment at this stop. Gating a
phase on that, not on barcode-set completeness, is deliberate — see
`is_scan_session_closed`.

Layering: integrations → config, mock_state. Never imports from api/ or orchestration/.
"""

import enum
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from app.core.config import settings
from app.integrations.mock_state import build_key, get_mock_state_store

logger = logging.getLogger(__name__)

# Redis key kind for scan state, keeping it distinct from staged PP state.
_SCAN_KEY_KIND = "scan"

# Session state is a SEPARATE key from staged barcodes. Sharing one key would mean
# closing a session rewrites the barcode payload, and a mis-ordered trigger in the
# dev panel would silently wipe what the warehouse "scanned".
_SESSION_KEY_KIND = "scan-session"


class ScanDirection(str, enum.Enum):
    """Which way through the warehouse door the parcel went.

    Deliberately NOT added to db/models/enums.py: this is the feed's vocabulary,
    it is never persisted as a column, and enums.py is read by every branch.
    """

    OUT = "out"   # scanned onto the truck at a pickup stop  → Parcel.pp_scan_out_at
    IN = "in"     # scanned off the truck at a delivery stop → Parcel.pp_scan_in_at


@dataclass(frozen=True)
class ScanEvent:
    """One barcode scanned at one stop, in one direction.

    Frozen because an observed scan is evidence: nothing downstream may edit it
    in place. `stop_reference` and `consignment_reference` are strings rather
    than UUIDs on purpose — a real WMS keys on a waybill number and a depot code,
    not on FreightProof's primary keys, and the interface has to survive that.
    """

    barcode: str
    direction: ScanDirection
    scanned_at: datetime
    consignment_reference: str
    stop_reference: str


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

        This, not set-completeness, is what gates a phase. A real WMS reports when an
        operator closes the session; it does not report "every expected barcode has now
        been seen", because a genuinely missing parcel means that never becomes true.
        Gating on completeness would turn a short count into an indefinite block instead
        of the finding it should be.
        """
        ...


class MockScanFeed:
    """Redis-backed stub — no warehouse. SCAN_FEED_USE_MOCK=True selects it.

    stage_scans() and close_session() are the simulated warehouse doing its job;
    they are called only by the dev trigger panel. poll_scans() and
    is_scan_session_closed() are the production read paths and are all that
    orchestration ever touches.
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
        """Record what the warehouse is about to report. Replaces any prior staging.

        Replace rather than append: re-staging is how a demo is corrected after a
        mis-click, and an appending store would silently accumulate barcodes
        across attempts and produce a discrepancy nobody triggered.
        """
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


def get_scan_feed() -> ScanFeed:
    """Return the configured scan feed. Mirrors get_pp_client().

    Callers depend on this factory rather than instantiating a feed directly, so
    mock/real selection stays centralised in config.
    """
    if settings.SCAN_FEED_USE_MOCK:
        return MockScanFeed()
    # No live warehouse feed exists: PP exposes no scan endpoint and we hold no
    # depot account. Raising is the honest behaviour — silently falling back to
    # the mock would let a production deployment believe it had real scan data.
    raise NotImplementedError(
        "No live warehouse scan feed is implemented — set SCAN_FEED_USE_MOCK=true"
    )
