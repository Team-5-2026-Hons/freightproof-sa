"""Parcel Perfect ecomService v28 API client.

PP uses a three-step auth flow before every fresh session:
  1. getSalt(email)              → salt
  2. MD5(password + salt)        → encrypted_password
  3. getSecureToken(email, enc.) → token_id

The token does not expire under normal use, so we cache it at module level
for the process lifetime. In mock mode the network is never touched.

PP JSON call shape (all GET):
  {PP_API_URL}?params={url-encoded JSON}&method={method}&class={class}&token_id={token}
token_id is omitted only for Auth.getSalt and Auth.getSecureToken.
"""

import copy
import hashlib
import json
import logging
import urllib.parse
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.integrations.mock_state import build_key, get_mock_state_store

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level token cache.
# Alive for the process lifetime — avoids a getSalt/getSecureToken round-trip
# on every waybill lookup. Cleared when get_single_waybill catches a ValueError,
# which triggers a one-shot re-auth retry in case the token was invalidated
# server-side (e.g. after a server restart or session expiry).
#
# Not protected by asyncio.Lock — concurrent requests may perform duplicate auth
# handshakes if _cached_token is None. In practice this wastes one round-trip;
# the resulting tokens are both valid and the last write wins. Acceptable for
# the current traffic level; add asyncio.Lock if this becomes a bottleneck.
# ---------------------------------------------------------------------------
_cached_token: Optional[str] = None


# ---------------------------------------------------------------------------
# Errors and capability flags
# ---------------------------------------------------------------------------


class PPWaybillNotFoundError(Exception):
    """Raised when PP has no waybill for the given reference."""

    def __init__(self, waybill_number: str) -> None:
        self.waybill_number = waybill_number
        super().__init__(f"Waybill {waybill_number!r} not found in Parcel Perfect")


class PPUnsupportedError(Exception):
    """Raised when a capability doesn't exist on the real PP v28 API."""


# ---------------------------------------------------------------------------
# HTTP timeout for all PP calls.
# PP's spec gives no explicit SLA; 15 s matches our Hedera bound as a safe cap.
# ---------------------------------------------------------------------------
_PP_TIMEOUT_SECONDS: float = 15.0


# ---------------------------------------------------------------------------
# Response dataclasses (parsed from PP JSON payload)
# ---------------------------------------------------------------------------


@dataclass
class PPTrack:
    """A single parcel tracking barcode within a waybill."""

    trackno: str
    parcelno: int
    item: int


@dataclass
class PPContents:
    """One line-item of cargo contents on a waybill."""

    item: int
    description: str
    actmass: float
    pieces: int


@dataclass
class PPWaybillRef:
    """A client reference number attached to a waybill (wayrefs array)."""

    reference: str
    pageno: int


@dataclass
class PPWaybillDetails:
    """Core waybill header fields returned by getSingleWaybill.

    Extended fields (service, orig_*, freight_total, etc.) are populated from
    the full getSingleWaybill response — see raw dump in integration notes.
    poddate is non-empty string when PP has confirmed delivery; empty string
    means the consignment is still in transit or not yet collected.
    failtype is non-None when PP records a delivery failure (e.g. "not home").
    """

    waybill: str
    waydate: str
    pieces: int
    duedate: str
    declared_value: Optional[float]
    # Destination
    dest_address: str
    dest_town: str
    dest_person: str
    dest_contact: str
    # Origin — useful for pre-populating the trip creation form
    orig_person: str
    orig_town: str
    orig_address: str
    # Service and logistics
    service: str
    actual_weight_kg: Optional[float]
    freight_total: Optional[float]       # total charge incl. VAT from PP
    # POD — empty string = not yet delivered; date string = delivery confirmed
    poddate: str
    # Failure — None = no failure recorded; string = failure reason from PP
    failtype: Optional[str]
    # Client reference on the waybill
    client_reference: str
    # Customer account holding the booking — resolves the client Organization.
    accnum: str = ""
    custname: str = ""
    # PP "last manifest number"; 0/absent = not manifested → normalised to None.
    manifest: Optional[int] = None


@dataclass
class PPWaybillResponse:
    """Parsed top-level getSingleWaybill result (one entry from `results`)."""

    details: PPWaybillDetails
    contents: list[PPContents]
    tracks: list[PPTrack]
    wayrefs: list[PPWaybillRef]

    @property
    def is_delivered(self) -> bool:
        """True when PP has recorded a POD date — delivery is confirmed."""
        return bool(self.details.poddate)

    @property
    def has_delivery_failure(self) -> bool:
        """True when PP has recorded a delivery failure reason."""
        return self.details.failtype is not None


# ---------------------------------------------------------------------------
# Mock fixture
# ---------------------------------------------------------------------------

# The PP account carried by scripts/seed_demo.py's principal Organization
# (pp_account_number="MOCK01"). Consignment sync resolves the client org through
# this value, so it must stay in step with the seeder.
_DEMO_PP_ACCOUNT = "MOCK01"
_DEMO_PP_CUSTOMER = "CGY Logistics"

# Manifest groupings. 69/70 belong to the original WAY00x fixtures and are asserted
# by tests - never add to them. Each seeded trip gets its own manifest so a wizard
# manifest lookup returns exactly one trip's cargo, and the unassigned pool gets its
# own so the bulk-fetch path has a clean happy path that creates no conflicts.
_MANIFEST_SINGLE = 71
_MANIFEST_XDOCK = 72
_MANIFEST_ACTIVE = 73
_MANIFEST_CLOSED = 74
UNASSIGNED_MANIFEST_NUMBER = 80

MOCK_WAYBILL_RESPONSE = PPWaybillResponse(
    details=PPWaybillDetails(
        waybill="MOCKWAY001",
        waydate="01.01.2024",
        pieces=2,
        duedate="03.01.2024",
        declared_value=1500.00,
        dest_address="1 Hertzog Boulevard",
        dest_town="CAPE TOWN",
        dest_person="Mock Receiver",
        dest_contact="0210000001",
        orig_person="Mock Shipper",
        orig_town="JOHANNESBURG",
        orig_address="1 Mock Street",
        service="ONX",
        actual_weight_kg=10.0,
        freight_total=None,
        poddate="",
        failtype=None,
        client_reference="MOCKREF001",
        accnum="MOCK01",
        custname="CGY Logistics",
        manifest=69,
    ),
    contents=[
        PPContents(item=1, description="General Cargo", actmass=10.0, pieces=2),
    ],
    tracks=[
        PPTrack(trackno="MOCKWAY0010001", parcelno=1, item=1),
        PPTrack(trackno="MOCKWAY0010002", parcelno=2, item=1),
    ],
    wayrefs=[],
)


def _mock_waybill(
    *,
    waybill: str,
    accnum: str,
    custname: str,
    manifest: Optional[int],
    parcel_count: int,
    contents: list[PPContents],
    dest_town: str,
    dest_person: str,
    weight_kg: float,
    declared_value: Optional[float] = None,
    poddate: str = "",
    failtype: Optional[str] = None,
    dest_address: str = "1 Delivery Road",
    orig_person: str = "CGY Warehouse",
    orig_town: str = "JOHANNESBURG",
    orig_address: str = "1 Depot Street, Linbro Park",
) -> PPWaybillResponse:
    """Fixture factory - field shapes strictly follow the v28 getSingleWaybill spec.

    Origin/destination default to the original single-route fixtures (WAY00x) so
    those entries and every test asserting on them are unaffected; the seeded-trip
    fixtures below override them to state their real leg.
    """
    return PPWaybillResponse(
        details=PPWaybillDetails(
            waybill=waybill,
            waydate="01.07.2026",
            pieces=parcel_count,
            duedate="03.07.2026",
            declared_value=declared_value,
            dest_address=dest_address,
            dest_town=dest_town,
            dest_person=dest_person,
            dest_contact="0210000001",
            orig_person=orig_person,
            orig_town=orig_town,
            orig_address=orig_address,
            service="ONX",
            actual_weight_kg=weight_kg,
            freight_total=None,
            poddate=poddate,
            failtype=failtype,
            client_reference=f"REF-{waybill}",
            accnum=accnum,
            custname=custname,
            manifest=manifest,
        ),
        contents=contents,
        tracks=[
            PPTrack(trackno=f"{waybill}{n:04d}", parcelno=n, item=1)
            for n in range(1, parcel_count + 1)
        ],
        wayrefs=[],
    )


# ---------------------------------------------------------------------------
# Demo depot geography.
#
# The three precincts scripts/seed_demo.py creates. Seeded-trip fixtures draw
# their origin/destination from here so a waybill's stated leg matches the trip
# route the seeder actually builds - otherwise the dispatcher's consignment panel
# contradicts the trip's own stops, which on an evidence platform reads as
# tampering rather than as a fixture mismatch.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Depot:
    """A demo depot's PP-facing address fields."""

    town: str
    address: str
    contact_person: str


_CPT = _Depot("CAPE TOWN", "12 Gunners Circle, Epping Industria", "Epping Goods Inwards")
_BFN = _Depot("BLOEMFONTEIN", "8 Reid Street, Hamilton", "Hamilton Cross-Dock")
_JHB = _Depot("JOHANNESBURG", "1 Depot Street, Linbro Park", "Linbro Receiving")


def _routed_waybill(
    *,
    waybill: str,
    origin: _Depot,
    destination: _Depot,
    manifest: Optional[int],
    parcel_count: int,
    contents: list[PPContents],
    weight_kg: float,
    declared_value: Optional[float] = None,
    poddate: str = "",
    accnum: str = _DEMO_PP_ACCOUNT,
    custname: str = _DEMO_PP_CUSTOMER,
) -> PPWaybillResponse:
    """A fixture that states a real leg between two demo depots.

    Defaults to the demo principal's PP account so consignment sync resolves a
    client Organization - an unresolved client org is a warning path, and every
    seeded trip showing that warning would train the reviewer to ignore it.
    """
    return _mock_waybill(
        waybill=waybill,
        accnum=accnum,
        custname=custname,
        manifest=manifest,
        parcel_count=parcel_count,
        contents=contents,
        weight_kg=weight_kg,
        declared_value=declared_value,
        poddate=poddate,
        dest_town=destination.town,
        dest_address=destination.address,
        dest_person=destination.contact_person,
        orig_town=origin.town,
        orig_address=origin.address,
        orig_person=f"{origin.town.title()} Dispatch",
    )


# accnum "MOCK01" maps to the seeded demo principal org; "UNMAP9" deliberately
# has no Organization row — it exercises the unmapped-client warning path.
MOCK_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        _mock_waybill(waybill="WAY001", accnum="MOCK01", custname="CGY Logistics",
                      manifest=69, parcel_count=5, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=620.0, declared_value=15000.0,
                      contents=[PPContents(item=1, description="Steel brackets", actmass=620.0, pieces=5)]),
        _mock_waybill(waybill="WAY002", accnum="MOCK01", custname="CGY Logistics",
                      manifest=69, parcel_count=14, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=210.5,
                      contents=[PPContents(item=1, description="Electronics", actmass=180.5, pieces=10),
                                PPContents(item=2, description="Cables", actmass=30.0, pieces=4)]),
        _mock_waybill(waybill="WAY003", accnum="MOCK01", custname="CGY Logistics",
                      manifest=69, parcel_count=1, dest_town="PINETOWN",
                      dest_person="Store 12", weight_kg=8.0,
                      contents=[PPContents(item=1, description="Documents", actmass=8.0, pieces=1)]),
        _mock_waybill(waybill="WAY004", accnum="UNMAP9", custname="Unmapped Client (Pty) Ltd",
                      manifest=70, parcel_count=3, dest_town="CAPE TOWN",
                      dest_person="Goods Inwards", weight_kg=95.0,
                      contents=[PPContents(item=1, description="Textiles", actmass=95.0, pieces=3)]),
        _mock_waybill(waybill="WAY005", accnum="MOCK01", custname="CGY Logistics",
                      manifest=70, parcel_count=2, dest_town="CAPE TOWN",
                      dest_person="Goods Inwards", weight_kg=1450.0, declared_value=80000.0,
                      contents=[PPContents(item=1, description="Machine parts", actmass=1450.0, pieces=2)]),
        _mock_waybill(waybill="WAYPOD1", accnum="MOCK01", custname="CGY Logistics",
                      manifest=None, parcel_count=2, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=44.0, poddate="10.07.2026",
                      contents=[PPContents(item=1, description="Spares", actmass=44.0, pieces=2)]),
        _mock_waybill(waybill="WAYFAIL1", accnum="MOCK01", custname="CGY Logistics",
                      manifest=None, parcel_count=1, dest_town="DURBAN",
                      dest_person="DC Receiving", weight_kg=12.0, failtype="Receiver not home",
                      contents=[PPContents(item=1, description="Samples", actmass=12.0, pieces=1)]),
    ]
}
# Back-compat: existing tests reference MOCKWAY001 / MOCK_WAYBILL_RESPONSE.
MOCK_WAYBILLS[MOCK_WAYBILL_RESPONSE.details.waybill] = MOCK_WAYBILL_RESPONSE


# ---------------------------------------------------------------------------
# Seeded-trip fixtures - the cargo scripts/seed_trips.py puts on demo trips.
#
# These exist because the seeder used to invent references PP had never heard of,
# so the dispatcher wizard's fail-closed lookup 404'd on its own demo data. Every
# reference the seeder consumes must resolve here; tests/unit/test_seed_fixtures.py
# fails the build if the two ever drift apart again.
#
# Legs match the routes seed_trips.py builds:
#   SINGLE  CPT -> JHB
#   XDOCK   CPT -> BFN -> JHB, with one consignment per leg shape
#   ACTIVE  same shape as XDOCK, walked partway through
#   CLOSED  CPT -> JHB, delivered (carries a poddate, as PP would)
# ---------------------------------------------------------------------------

SEEDED_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        # --- SINGLE: one consignment, straight through -----------------------
        _routed_waybill(
            waybill="MOCKWB0001", origin=_CPT, destination=_JHB,
            manifest=_MANIFEST_SINGLE, parcel_count=18, weight_kg=840.0,
            declared_value=42000.0,
            contents=[PPContents(item=1, description="Retail FMCG cartons", actmass=840.0, pieces=18)],
        ),
        # --- XDOCK: A straight through, B dropped at hub, C collected at hub --
        _routed_waybill(
            waybill="MOCKWB0002", origin=_CPT, destination=_JHB,
            manifest=_MANIFEST_XDOCK, parcel_count=9, weight_kg=310.0,
            declared_value=18500.0,
            contents=[PPContents(item=1, description="Pharmaceutical totes", actmass=310.0, pieces=9)],
        ),
        _routed_waybill(
            waybill="MOCKWB0003", origin=_CPT, destination=_BFN,
            manifest=_MANIFEST_XDOCK, parcel_count=24, weight_kg=1120.5,
            declared_value=63000.0,
            contents=[PPContents(item=1, description="Canned goods", actmass=960.5, pieces=20),
                      PPContents(item=2, description="Glassware", actmass=160.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="MOCKWB0004", origin=_BFN, destination=_JHB,
            manifest=_MANIFEST_XDOCK, parcel_count=6, weight_kg=275.0,
            declared_value=9800.0,
            contents=[PPContents(item=1, description="Agricultural spares", actmass=275.0, pieces=6)],
        ),
        # --- ACTIVE: same three leg shapes, different cargo -------------------
        _routed_waybill(
            waybill="MOCKWB0005", origin=_CPT, destination=_JHB,
            manifest=_MANIFEST_ACTIVE, parcel_count=11, weight_kg=495.0,
            declared_value=27500.0,
            contents=[PPContents(item=1, description="Consumer electronics", actmass=495.0, pieces=11)],
        ),
        _routed_waybill(
            waybill="MOCKWB0006", origin=_CPT, destination=_BFN,
            manifest=_MANIFEST_ACTIVE, parcel_count=30, weight_kg=1580.0,
            declared_value=71000.0,
            contents=[PPContents(item=1, description="Bottled beverages", actmass=1400.0, pieces=26),
                      PPContents(item=2, description="Promotional stands", actmass=180.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="MOCKWB0007", origin=_BFN, destination=_JHB,
            manifest=_MANIFEST_ACTIVE, parcel_count=4, weight_kg=88.0,
            declared_value=5400.0,
            contents=[PPContents(item=1, description="Workshop tooling", actmass=88.0, pieces=4)],
        ),
        # --- CLOSED: delivered, so PP reports a POD date ----------------------
        _routed_waybill(
            waybill="MOCKWB0008", origin=_CPT, destination=_JHB,
            manifest=_MANIFEST_CLOSED, parcel_count=7, weight_kg=232.0,
            declared_value=15600.0, poddate="24.07.2026",
            contents=[PPContents(item=1, description="Automotive filters", actmass=232.0, pieces=7)],
        ),
    ]
}

# ---------------------------------------------------------------------------
# Unassigned pool - valid references deliberately left off every seeded trip.
#
# The wizard needs waybills it can actually create a NEW trip from. Without this
# pool a demo has only two options: reuse a seeded reference (now a 409, since a
# consignment belongs to exactly one trip) or type something PP does not know
# (404). Both are dead ends, and neither is the flow being demonstrated.
#
# FREEWB0001-0010 are unlabelled and safe to spend anywhere. FREEWB0011-0015 are
# explicitly a testing batch (dev/CI use); FREEWB0016-0020 are explicitly a demo
# batch — leave those alone outside the live walkthrough, since a reference spent
# by mistake is a 409 mid-demo, not a fixture bug.
# ---------------------------------------------------------------------------

UNASSIGNED_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        _routed_waybill(
            waybill="FREEWB0001", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=12, weight_kg=520.0,
            declared_value=31000.0,
            contents=[PPContents(item=1, description="Packaged textiles", actmass=520.0, pieces=12)],
        ),
        _routed_waybill(
            waybill="FREEWB0002", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=5, weight_kg=147.5,
            declared_value=8200.0,
            contents=[PPContents(item=1, description="Laboratory consumables", actmass=147.5, pieces=5)],
        ),
        _routed_waybill(
            waybill="FREEWB0003", origin=_BFN, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=21, weight_kg=990.0,
            declared_value=44500.0,
            contents=[PPContents(item=1, description="Building hardware", actmass=830.0, pieces=17),
                      PPContents(item=2, description="Sealants", actmass=160.0, pieces=4)],
        ),
        # Deliberately off the shared manifest: the wizard must also work for a
        # waybill entered one at a time, not only via bulk manifest fetch.
        _routed_waybill(
            waybill="FREEWB0004", origin=_JHB, destination=_CPT,
            manifest=None, parcel_count=3, weight_kg=61.0,
            declared_value=12750.0,
            contents=[PPContents(item=1, description="Returned equipment", actmass=61.0, pieces=3)],
        ),
        # Unmapped PP account - exercises the "client org not resolved" warning on
        # a trip the dispatcher creates themselves, not just in tests.
        _routed_waybill(
            waybill="FREEWB0005", origin=_CPT, destination=_JHB,
            manifest=None, parcel_count=2, weight_kg=39.0,
            declared_value=4100.0,
            accnum="UNMAP9", custname="Unmapped Client (Pty) Ltd",
            contents=[PPContents(item=1, description="Trade samples", actmass=39.0, pieces=2)],
        ),
        _routed_waybill(
            waybill="FREEWB0006", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=8, weight_kg=310.0,
            declared_value=19500.0,
            contents=[PPContents(item=1, description="Office furniture", actmass=310.0, pieces=8)],
        ),
        _routed_waybill(
            waybill="FREEWB0007", origin=_JHB, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=16, weight_kg=705.0,
            declared_value=38200.0,
            contents=[PPContents(item=1, description="Packaged foodstuffs", actmass=705.0, pieces=16)],
        ),
        _routed_waybill(
            waybill="FREEWB0008", origin=_BFN, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=4, weight_kg=52.0,
            declared_value=6800.0,
            contents=[PPContents(item=1, description="Medical supplies", actmass=52.0, pieces=4)],
        ),
        # Deliberately off the shared manifest, like FREEWB0004: covers the
        # one-at-a-time entry path rather than bulk manifest fetch.
        _routed_waybill(
            waybill="FREEWB0009", origin=_JHB, destination=_CPT,
            manifest=None, parcel_count=6, weight_kg=178.0,
            declared_value=22000.0,
            contents=[PPContents(item=1, description="Hardware tools", actmass=178.0, pieces=6)],
        ),
        _routed_waybill(
            waybill="FREEWB0010", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=10, weight_kg=430.0,
            declared_value=27500.0,
            contents=[PPContents(item=1, description="Automotive parts", actmass=430.0, pieces=10)],
        ),
        # --- Testing batch: spend freely against the dispatcher wizard in dev/CI ---
        _routed_waybill(
            waybill="FREEWB0011", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=7, weight_kg=265.0,
            declared_value=16200.0,
            contents=[PPContents(item=1, description="Warehouse racking", actmass=265.0, pieces=7)],
        ),
        _routed_waybill(
            waybill="FREEWB0012", origin=_JHB, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=13, weight_kg=580.0,
            declared_value=29800.0,
            contents=[PPContents(item=1, description="Packaged stationery", actmass=580.0, pieces=13)],
        ),
        _routed_waybill(
            waybill="FREEWB0013", origin=_BFN, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=3, weight_kg=41.0,
            declared_value=7600.0,
            contents=[PPContents(item=1, description="Optical instruments", actmass=41.0, pieces=3)],
        ),
        # Deliberately off the shared manifest, like FREEWB0004/0009: covers the
        # one-at-a-time entry path rather than bulk manifest fetch.
        _routed_waybill(
            waybill="FREEWB0014", origin=_CPT, destination=_BFN,
            manifest=None, parcel_count=19, weight_kg=910.0,
            declared_value=48500.0,
            contents=[PPContents(item=1, description="Retail apparel", actmass=910.0, pieces=19)],
        ),
        _routed_waybill(
            waybill="FREEWB0015", origin=_JHB, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=5, weight_kg=132.0,
            declared_value=9100.0,
            contents=[PPContents(item=1, description="Lab reagent kits", actmass=132.0, pieces=5)],
        ),
        # --- Demo batch: reserve for the live walkthrough, do not spend in dev/CI ---
        _routed_waybill(
            waybill="FREEWB0016", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=15, weight_kg=690.0,
            declared_value=35400.0,
            contents=[PPContents(item=1, description="Consumer appliances", actmass=690.0, pieces=15)],
        ),
        _routed_waybill(
            waybill="FREEWB0017", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=8, weight_kg=305.0,
            declared_value=21000.0,
            contents=[PPContents(item=1, description="Furniture fittings", actmass=305.0, pieces=8)],
        ),
        _routed_waybill(
            waybill="FREEWB0018", origin=_BFN, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=22, weight_kg=1040.0,
            declared_value=57200.0,
            contents=[PPContents(item=1, description="Bagged agricultural feed", actmass=890.0, pieces=18),
                      PPContents(item=2, description="Veterinary supplies", actmass=150.0, pieces=4)],
        ),
        # Deliberately off the shared manifest, like FREEWB0004/0009: covers the
        # one-at-a-time entry path rather than bulk manifest fetch.
        _routed_waybill(
            waybill="FREEWB0019", origin=_JHB, destination=_CPT,
            manifest=None, parcel_count=4, weight_kg=76.0,
            declared_value=13900.0,
            contents=[PPContents(item=1, description="Returned electronics", actmass=76.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="FREEWB0020", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=11, weight_kg=470.0,
            declared_value=26800.0,
            contents=[PPContents(item=1, description="Household goods", actmass=470.0, pieces=11)],
        ),
    ]
}

MOCK_WAYBILLS.update(SEEDED_WAYBILLS)
MOCK_WAYBILLS.update(UNASSIGNED_WAYBILLS)


# ---------------------------------------------------------------------------
# Mock client
# ---------------------------------------------------------------------------


# Redis key kind for staged PP waybill overrides, distinct from staged scan state.
_PP_KEY_KIND = "pp"


class MockParcelPerfectClient:
    """Fixture-backed stub — no network. PP_USE_MOCK=True selects it via get_pp_client().

    Unknown references raise PPWaybillNotFoundError, matching the real client, so
    the fail-closed 422 path behaves identically in dev/CI and against live PP.

    When the dev trigger panel is enabled, a Redis-held override layer is applied
    on top of each fixture. This exists because PP waybills were verified to be
    mutable after creation (spec §B2c: a portal edit changed 68 fields in one
    10-second poll interval, growing tracks[] from 2 to 27 barcodes), and the
    Celery poll that would observe such a change runs in a different process from
    the API — so a module-level dict mutation would be invisible to it.

    The override lookup is gated on DEV_PANEL_ENABLED so that normal operation
    never touches Redis and every existing PP test runs unchanged.
    """

    supports_manifest_lookup: bool = True

    def _override_key(self, waybill_number: str) -> str:
        return build_key(_PP_KEY_KIND, waybill_number)

    async def stage_waybill_override(
        self,
        waybill_number: str,
        *,
        manifest: Optional[int] = None,
        poddate: Optional[str] = None,
        failtype: Optional[str] = None,
        parcel_count: Optional[int] = None,
    ) -> None:
        """Stage a change to a fixture waybill, as if edited in the PP portal.

        Only supplied fields are staged; the rest of the fixture is untouched.
        Staging is additive across calls, so a manifest number set earlier survives
        a later poddate change — that is how a real waybill accumulates state.

        Raises:
            PPUnsupportedError: PP_USE_MOCK is false. Staging a fixture change
                while pointed at live PP is a bug, and silently ignoring it would
                make a demo look like it worked when nothing happened.
            PPWaybillNotFoundError: the reference is not in the fixture library.
        """
        if not settings.PP_USE_MOCK:
            raise PPUnsupportedError(
                "Cannot stage a waybill override while PP_USE_MOCK is false"
            )
        if waybill_number not in MOCK_WAYBILLS:
            raise PPWaybillNotFoundError(waybill_number)

        key = self._override_key(waybill_number)
        store = get_mock_state_store()
        current = await store.get_json(key) or {}
        staged = {
            **current,
            **{
                field: value
                for field, value in (
                    ("manifest", manifest),
                    ("poddate", poddate),
                    ("failtype", failtype),
                    ("parcel_count", parcel_count),
                )
                if value is not None
            },
        }
        await store.set_json(key, staged)
        logger.info("Staged PP override for waybill=%s fields=%s", waybill_number, sorted(staged))

    async def _apply_overrides(self, waybill: PPWaybillResponse) -> PPWaybillResponse:
        """Apply any staged override to a fixture copy. No-op when none is staged."""
        if not settings.DEV_PANEL_ENABLED:
            return waybill

        staged = await get_mock_state_store().get_json(
            self._override_key(waybill.details.waybill)
        )
        if not staged:
            return waybill

        if (manifest := staged.get("manifest")) is not None:
            waybill.details.manifest = int(manifest)
        if (poddate := staged.get("poddate")) is not None:
            waybill.details.poddate = str(poddate)
        if (failtype := staged.get("failtype")) is not None:
            waybill.details.failtype = str(failtype)
        if (parcel_count := staged.get("parcel_count")) is not None:
            # Regenerate tracks[] to the new size, keeping the fixture's barcode
            # format. This reproduces the real failure mode: the expected parcel
            # set — the baseline every reconciliation is measured against — grows
            # with no version, timestamp or audit field on the waybill.
            count = int(parcel_count)
            reference = waybill.details.waybill
            waybill.tracks = [
                PPTrack(trackno=f"{reference}{n:04d}", parcelno=n, item=1)
                for n in range(1, count + 1)
            ]
            waybill.details.pieces = count

        return waybill

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        """Look up the waybill in the fixture library; raise if unregistered."""
        logger.info("MockParcelPerfectClient.get_single_waybill waybill=%s", waybill_number)
        try:
            # Deep copy: callers may mutate results; module-level fixtures must stay pristine.
            waybill = copy.deepcopy(MOCK_WAYBILLS[waybill_number])
        except KeyError as exc:
            raise PPWaybillNotFoundError(waybill_number) from exc
        return await self._apply_overrides(waybill)

    async def get_waybills_by_manifest(self, manifest_number: int) -> list[PPWaybillResponse]:
        """ASPIRATIONAL — PP v28 has no such endpoint (ask #1, July visit).
        Mock-only so the wizard can demo manifest-keyed trip creation."""
        # Deep copy: callers may mutate results; module-level fixtures must stay pristine.
        return copy.deepcopy(
            sorted(
                (w for w in MOCK_WAYBILLS.values() if w.details.manifest == manifest_number),
                key=lambda w: w.details.waybill,
            )
        )


# ---------------------------------------------------------------------------
# Real client
# ---------------------------------------------------------------------------


class ParcelPerfectClient:
    """Async client for the Parcel Perfect ecomService v28 JSON API.

    Auth is performed lazily on the first call and the token is cached
    at module level for subsequent calls within the same process.
    """

    supports_manifest_lookup: bool = False

    async def get_waybills_by_manifest(self, manifest_number: int) -> list[PPWaybillResponse]:
        raise PPUnsupportedError(
            "PP v28 exposes no manifest-contents endpoint — requested from PP (ask #1, July visit)"
        )

    async def _make_call(
        self,
        class_name: str,
        method: str,
        params: dict[str, object],
        token: Optional[str] = None,
    ) -> list:
        """Execute a single PP JSON GET request and return the `results` list.

        `token` is omitted only for Auth.getSalt and Auth.getSecureToken — in
        those cases pass token=None and it will not be appended to the query string.

        Raises ValueError if PP returns errorcode != 0.
        Raises httpx.HTTPStatusError on non-2xx HTTP responses.
        """
        # urllib.parse.urlencode ensures special characters in param values
        # are percent-encoded — manual string building breaks on addresses, etc.
        query: dict[str, str] = {
            "params": json.dumps(params),
            "method": method,
            "class": class_name,
        }
        if token is not None:
            query["token_id"] = token

        url = f"{settings.PP_API_URL}?{urllib.parse.urlencode(query)}"

        async with httpx.AsyncClient(timeout=_PP_TIMEOUT_SECONDS) as client:
            response = await client.get(url)

        response.raise_for_status()

        # httpx's .json() returns Any — we annotate the dict keys as str but leave
        # values as Any because the PP response schema is not statically knowable here.
        body: dict[str, Any] = response.json()
        errorcode: int = body.get("errorcode", -1)
        errormessage: str = body.get("errormessage", "unknown PP error")

        if errorcode != 0:
            logger.error(
                "PP API error class=%s method=%s errorcode=%s message=%s",
                class_name,
                method,
                errorcode,
                errormessage,
            )
            raise ValueError(f"Parcel Perfect error {errorcode}: {errormessage}")

        return body.get("results", [])

    async def _get_token(self) -> str:
        """Return a valid PP token_id, running the auth flow if not yet cached.

        If PP_API_TOKEN is set in config it is used directly, skipping the
        getSalt/getSecureToken round-trip. This supports pre-issued tokens that
        PP sometimes provides alongside credentials.

        Auth steps (only when PP_API_TOKEN is empty) follow the v28 spec:
          getSalt(email) → salt
          MD5(password + salt) → encrypted_password
          getSecureToken(email, encrypted_password) → token_id
        """
        global _cached_token
        if _cached_token is not None:
            return _cached_token

        # Use the pre-issued token directly if configured — no auth round-trip needed.
        if settings.PP_API_TOKEN:
            _cached_token = settings.PP_API_TOKEN
            logger.info("PP pre-issued token loaded from config")
            return _cached_token

        email = settings.PP_API_KEY
        password = settings.PP_API_PASSWORD

        # Step 1: fetch a per-session salt tied to the account email.
        salt_results = await self._make_call(
            class_name="Auth",
            method="getSalt",
            params={"email": email},
        )
        if not salt_results:
            raise ValueError("PP getSalt returned empty results")
        salt: str = salt_results[0]["salt"]

        # Step 2: hash exactly as the v28 spec requires — MD5(password + salt).
        encrypted_password = hashlib.md5(f"{password}{salt}".encode()).hexdigest()

        # Step 3: exchange credentials for a session token.
        token_results = await self._make_call(
            class_name="Auth",
            method="getSecureToken",
            params={"email": email, "encrypted_password": encrypted_password},
        )
        if not token_results:
            raise ValueError("PP getSecureToken returned empty results")
        token: str = token_results[0]["token_id"]

        _cached_token = token
        logger.info("PP token obtained and cached for process lifetime")
        return _cached_token

    def _parse_waybill_response(self, raw: dict[str, Any]) -> PPWaybillResponse:
        """Map a single entry from PP's getSingleWaybill `results` list to PPWaybillResponse.

        PP field names are kept as-is in the dataclasses where they match the spec;
        only `declaredvalue` and dest fields are renamed for Python clarity.
        """
        details_raw: dict[str, Any] = raw.get("details", {})

        # PP returns failtype as null (None) when no failure has been recorded.
        # We preserve that distinction: None = no failure, string = failure reason.
        failtype_raw = details_raw.get("failtype")
        failtype: Optional[str] = str(failtype_raw) if failtype_raw is not None else None

        details = PPWaybillDetails(
            waybill=details_raw["waybill"],
            waydate=details_raw.get("waydate", ""),
            pieces=int(details_raw.get("pieces", 0)),
            duedate=details_raw.get("duedate", ""),
            declared_value=float(details_raw["declaredvalue"]) if details_raw.get("declaredvalue") is not None else None,
            # Destination
            dest_address=details_raw.get("destperadd1", ""),
            dest_town=details_raw.get("desttown", ""),
            dest_person=details_raw.get("destpers", ""),
            dest_contact=details_raw.get("destpertel", ""),
            # Origin
            orig_person=details_raw.get("origpers", ""),
            orig_town=details_raw.get("origtown", ""),
            orig_address=details_raw.get("origperadd1", ""),
            # Service
            service=details_raw.get("service", ""),
            actual_weight_kg=float(details_raw["actkg"]) if details_raw.get("actkg") is not None else None,
            freight_total=float(details_raw["total"]) if details_raw.get("total") is not None else None,
            # POD / failure
            poddate=details_raw.get("poddate", ""),
            failtype=failtype,
            # Client reference (first wayref, if present — also stored in wayrefs list)
            client_reference=details_raw.get("reference", ""),
            # Customer account / name — resolves the client Organization downstream.
            accnum=details_raw.get("accnum", ""),
            custname=details_raw.get("custname", ""),
            # 0 or absent means "not yet manifested" — normalise to None.
            manifest=int(m) if (m := details_raw.get("manifest")) and int(m) > 0 else None,
        )

        contents = [
            PPContents(
                item=int(c["item"]) if c.get("item") is not None else 0,
                description=c.get("description") or "",
                actmass=float(c["actmass"]) if c.get("actmass") is not None else 0.0,
                pieces=int(c["pieces"]) if c.get("pieces") is not None else 0,
            )
            for c in raw.get("contents", [])
        ]

        tracks = [
            PPTrack(
                trackno=t["trackno"],
                parcelno=int(t["parcelno"]) if t.get("parcelno") is not None else 0,
                item=int(t["item"]) if t.get("item") is not None else 0,
            )
            for t in raw.get("tracks", [])
            if t.get("trackno")  # skip malformed entries with no barcode
        ]

        wayrefs = [
            PPWaybillRef(
                reference=r.get("reference", ""),
                pageno=int(r["pageno"]) if r.get("pageno") is not None else 0,
            )
            for r in raw.get("wayrefs", [])
        ]

        return PPWaybillResponse(details=details, contents=contents, tracks=tracks, wayrefs=wayrefs)

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        """Fetch a waybill from Parcel Perfect and return a typed PPWaybillResponse.

        Authenticates lazily on first call. If the first attempt raises ValueError
        and a cached token exists, we clear the cache and retry once — the token may
        have been invalidated server-side (session expiry, server restart, etc.).
        """
        global _cached_token

        token = await self._get_token()
        logger.info("ParcelPerfectClient.get_single_waybill waybill=%s", waybill_number)

        try:
            results = await self._make_call(
                "Waybill", "getSingleWaybill", {"waybillno": waybill_number}, token=token
            )
        except ValueError as exc:
            err_str = str(exc).lower()
            # Only retry when the failure looks like a token/session problem.
            # Domain errors (e.g. "Waybill not found") must not trigger re-auth,
            # as that would waste two extra network calls per bad waybill number.
            is_auth_failure = any(
                kw in err_str for kw in ("token", "auth", "session", "invalid credentials")
            )
            if _cached_token is not None and is_auth_failure:
                # Token invalidated server-side; clear cache and retry once.
                logger.warning("PP auth failure detected; clearing token cache and retrying")
                _cached_token = None
                token = await self._get_token()
                results = await self._make_call(
                    "Waybill", "getSingleWaybill", {"waybillno": waybill_number}, token=token
                )
            else:
                raise

        if not results:
            # Empty results with errorcode 0 is PP's "no matching waybill" signal —
            # distinguish this from genuine API/auth errors (raised above as ValueError)
            # so callers can fail closed on a real not-found without conflating it
            # with transport/auth failures.
            raise PPWaybillNotFoundError(waybill_number)

        return self._parse_waybill_response(results[0])


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_pp_client() -> ParcelPerfectClient | MockParcelPerfectClient:
    """Return the appropriate PP client based on settings.PP_USE_MOCK.

    Callers should depend on this factory rather than instantiating clients
    directly so that mock/real behaviour is controlled centrally via config.
    """
    if settings.PP_USE_MOCK:
        return MockParcelPerfectClient()
    return ParcelPerfectClient()
