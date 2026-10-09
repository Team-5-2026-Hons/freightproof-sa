"""Mock waybill fixtures: the original WAY00x set, the seeded-trip set and the demo depots they route between."""

from dataclasses import dataclass
from typing import Optional

from app.integrations.parcel_perfect.models import PPContents, PPTrack, PPWaybillDetails, PPWaybillResponse


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
    """A demo depot's PP-facing address fields and its PP hub code."""

    town: str
    address: str
    contact_person: str
    hub_code: str


_CPT = _Depot("CAPE TOWN", "12 Gunners Circle, Epping Industria", "Epping Goods Inwards", "CPT")
_BFN = _Depot("BLOEMFONTEIN", "8 Reid Street, Hamilton", "Hamilton Cross-Dock", "BFN")
_JHB = _Depot("JOHANNESBURG", "1 Depot Street, Linbro Park", "Linbro Receiving", "JNB")

# The hub codes scripts/seed_demo.py puts on the three demo precincts.
DEMO_HUB_CODES: frozenset[str] = frozenset({_CPT.hub_code, _BFN.hub_code, _JHB.hub_code})
# A real hub with no demo precinct: the unlinked-destination case (manifest 69).
_HUB_DURBAN = "DUR"


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

MOCK_WAYBILLS.update(SEEDED_WAYBILLS)
