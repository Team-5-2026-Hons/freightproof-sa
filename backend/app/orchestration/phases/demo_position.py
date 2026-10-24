"""The seam through which a demo-staged phone position reaches the phase paths.

An injected provider, not a direct import, for the same reason
orchestration/evidence_anchors/dispatch.py takes an EvidencePublisher: `app/dev` imports
orchestration, so orchestration importing `app/dev` back would close a cycle. app/main.py
wires the dev provider in at startup, and ONLY when the dev panel's own flags allow it —
so in a normal deployment no provider is ever configured and every function here answers
"use the device's own fix".

What a staged position is for: a demo runs from a room nowhere near the depots a trip
names, so the handset's real fix sits ~1000km from the expected precinct and every phase
records a location warning. Staging the phone at a precinct (dev panel -> "move the
phone") makes a walkthrough read the way a real trip would.

What it is NOT: a real capture. Every row written from a staged position is stamped
DriverPositionSource.SIMULATED by phases/driver_position.py, so the ledger says which
coordinates the handset actually produced and which this system placed there.
"""

import logging
import uuid
from decimal import Decimal
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

# Answers "where should this trip's phone be, for a demo?" — None for "wherever it says
# it is". Async because the dev implementation reads the mock-state store.
DemoPositionProvider = Callable[[uuid.UUID], Awaitable[Optional[tuple[Decimal, Decimal]]]]

_provider: Optional[DemoPositionProvider] = None


def configure_demo_position_provider(provider: Optional[DemoPositionProvider]) -> None:
    """Install (or, with None, remove) the staged-position source. Called by app/main.py."""
    global _provider
    _provider = provider


def demo_position_provider_configured() -> bool:
    """Whether any provider is installed. For diagnostics and tests, not control flow."""
    return _provider is not None


async def staged_demo_position(trip_id: uuid.UUID) -> Optional[tuple[Decimal, Decimal]]:
    """The position a demo has staged for this trip's phone, or None to use the real fix.

    None whenever no provider is installed (every normal deployment), nothing is staged,
    or the provider fails. A provider fault must never turn a phase submission into an
    error: the driver's own capture is always the safe fallback, so everything is
    swallowed here and logged.
    """
    provider = _provider
    if provider is None:
        return None

    try:
        return await provider(trip_id)
    except Exception:  # noqa: BLE001 — demo scaffolding may never break a real submit
        logger.exception(
            "Staged demo position lookup failed for trip=%s; using the device's own fix", trip_id,
        )
        return None
