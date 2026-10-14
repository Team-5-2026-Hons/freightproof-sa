"""Parcel Perfect port: the interface callers depend on instead of a concrete client.

Why this exists (Dependency Inversion): get_pp_client() hands back either the real
ParcelPerfectClient or the fixture-backed MockParcelPerfectClient, chosen by
PP_USE_MOCK. The two are interchangeable to every caller, so callers should depend on
this Protocol rather than on the concrete union. Mirrors ScanFeed in scan_feed.py.

The vendor name stays in the package name because the port's types are PP's own response
models. Those are imported for type checking only: the annotations below are strings
(`from __future__ import annotations`), so no runtime import is needed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.integrations.parcel_perfect.models import PPManifestResponse, PPWaybillResponse


class ParcelPerfectPort(Protocol):
    """What the real and mock Parcel Perfect clients both provide."""

    # Callers branch on this instead of catching PPUnsupportedError (the real client
    # has no manifest lookup; the mock does).
    supports_manifest_lookup: bool

    async def get_manifest(self, manifest_number: int) -> PPManifestResponse: ...

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse: ...
