"""Mock waybills left off every seeded trip, so a new trip can be created from them."""

from app.integrations.parcel_perfect.models import PPContents, PPWaybillResponse
from app.integrations.parcel_perfect.waybill_fixtures import (
    MOCK_WAYBILLS,
    UNASSIGNED_MANIFEST_NUMBER,
    _BFN,
    _CPT,
    _JHB,
    _routed_waybill,
)


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
        # --- Extra demo batch: added to give the live walkthrough more headroom ---
        _routed_waybill(
            waybill="FREEWB0021", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=14, weight_kg=620.0,
            declared_value=33500.0,
            contents=[PPContents(item=1, description="Industrial adhesives", actmass=620.0, pieces=14)],
        ),
        _routed_waybill(
            waybill="FREEWB0022", origin=_JHB, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=9, weight_kg=385.0,
            declared_value=20100.0,
            contents=[PPContents(item=1, description="Cleaning chemicals", actmass=385.0, pieces=9)],
        ),
        _routed_waybill(
            waybill="FREEWB0023", origin=_BFN, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=6, weight_kg=198.0,
            declared_value=11400.0,
            contents=[PPContents(item=1, description="Printed packaging", actmass=198.0, pieces=6)],
        ),
        _routed_waybill(
            waybill="FREEWB0024", origin=_CPT, destination=_BFN,
            manifest=None, parcel_count=20, weight_kg=950.0,
            declared_value=52000.0,
            contents=[PPContents(item=1, description="Frozen poultry", actmass=810.0, pieces=16),
                      PPContents(item=2, description="Cold-chain monitors", actmass=140.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="FREEWB0025", origin=_JHB, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=7, weight_kg=290.0,
            declared_value=17800.0,
            contents=[PPContents(item=1, description="Plumbing fittings", actmass=290.0, pieces=7)],
        ),
        _routed_waybill(
            waybill="FREEWB0026", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=17, weight_kg=780.0,
            declared_value=41200.0,
            contents=[PPContents(item=1, description="Crated glassware", actmass=780.0, pieces=17)],
        ),
        _routed_waybill(
            waybill="FREEWB0027", origin=_BFN, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=5, weight_kg=112.0,
            declared_value=8900.0,
            contents=[PPContents(item=1, description="Safety equipment", actmass=112.0, pieces=5)],
        ),
        _routed_waybill(
            waybill="FREEWB0028", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=12, weight_kg=540.0,
            declared_value=29600.0,
            contents=[PPContents(item=1, description="Steel fasteners", actmass=540.0, pieces=12)],
        ),
        _routed_waybill(
            waybill="FREEWB0029", origin=_JHB, destination=_CPT,
            manifest=None, parcel_count=8, weight_kg=215.0,
            declared_value=14300.0,
            contents=[PPContents(item=1, description="Refurbished monitors", actmass=215.0, pieces=8)],
        ),
        _routed_waybill(
            waybill="FREEWB0030", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=25, weight_kg=1150.0,
            declared_value=62000.0,
            contents=[PPContents(item=1, description="Tinned food pallets", actmass=980.0, pieces=21),
                      PPContents(item=2, description="Dry goods cartons", actmass=170.0, pieces=4)],
        ),
        # --- Second extra batch: added when live testing exhausted the pool above ---
        _routed_waybill(
            waybill="FREEWB0031", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=13, weight_kg=560.0,
            declared_value=31200.0,
            contents=[PPContents(item=1, description="Office furniture", actmass=560.0, pieces=13)],
        ),
        _routed_waybill(
            waybill="FREEWB0032", origin=_JHB, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=8, weight_kg=340.0,
            declared_value=19600.0,
            contents=[PPContents(item=1, description="Automotive batteries", actmass=340.0, pieces=8)],
        ),
        _routed_waybill(
            waybill="FREEWB0033", origin=_BFN, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=19, weight_kg=870.0,
            declared_value=45900.0,
            contents=[PPContents(item=1, description="Paint and coatings", actmass=870.0, pieces=19)],
        ),
        _routed_waybill(
            waybill="FREEWB0034", origin=_CPT, destination=_BFN,
            manifest=None, parcel_count=5, weight_kg=142.0,
            declared_value=8700.0,
            contents=[PPContents(item=1, description="Lab reagents", actmass=142.0, pieces=5)],
        ),
        _routed_waybill(
            waybill="FREEWB0035", origin=_JHB, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=22, weight_kg=990.0,
            declared_value=54000.0,
            contents=[PPContents(item=1, description="Bagged cement", actmass=850.0, pieces=17),
                      PPContents(item=2, description="Construction adhesives", actmass=140.0, pieces=5)],
        ),
        _routed_waybill(
            waybill="FREEWB0036", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=10, weight_kg=410.0,
            declared_value=23000.0,
            contents=[PPContents(item=1, description="Textile bales", actmass=410.0, pieces=10)],
        ),
        _routed_waybill(
            waybill="FREEWB0037", origin=_BFN, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=7, weight_kg=265.0,
            declared_value=16400.0,
            contents=[PPContents(item=1, description="Hydraulic seals", actmass=265.0, pieces=7)],
        ),
        _routed_waybill(
            waybill="FREEWB0038", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=16, weight_kg=705.0,
            declared_value=38800.0,
            contents=[PPContents(item=1, description="Ceramic tiles", actmass=705.0, pieces=16)],
        ),
        _routed_waybill(
            waybill="FREEWB0039", origin=_JHB, destination=_BFN,
            manifest=None, parcel_count=3, weight_kg=64.0,
            declared_value=4100.0,
            contents=[PPContents(item=1, description="Medical samples", actmass=64.0, pieces=3)],
        ),
        _routed_waybill(
            waybill="FREEWB0040", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=28, weight_kg=1310.0,
            declared_value=71500.0,
            contents=[PPContents(item=1, description="Bottled water pallets", actmass=1180.0, pieces=24),
                      PPContents(item=2, description="Beverage syrups", actmass=130.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="FREEWB0041", origin=_BFN, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=9, weight_kg=305.0,
            declared_value=17900.0,
            contents=[PPContents(item=1, description="Livestock feed", actmass=305.0, pieces=9)],
        ),
        _routed_waybill(
            waybill="FREEWB0042", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=6, weight_kg=118.0,
            declared_value=9300.0,
            contents=[PPContents(item=1, description="Telecom routers", actmass=118.0, pieces=6)],
        ),
        _routed_waybill(
            waybill="FREEWB0043", origin=_JHB, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=15, weight_kg=630.0,
            declared_value=34600.0,
            contents=[PPContents(item=1, description="Kitchen appliances", actmass=630.0, pieces=15)],
        ),
        _routed_waybill(
            waybill="FREEWB0044", origin=_BFN, destination=_JHB,
            manifest=None, parcel_count=11, weight_kg=475.0,
            declared_value=25700.0,
            contents=[PPContents(item=1, description="Tyres", actmass=475.0, pieces=11)],
        ),
        _routed_waybill(
            waybill="FREEWB0045", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=21, weight_kg=940.0,
            declared_value=51000.0,
            contents=[PPContents(item=1, description="Bagged rice", actmass=940.0, pieces=21)],
        ),
        _routed_waybill(
            waybill="FREEWB0046", origin=_JHB, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=4, weight_kg=52.0,
            declared_value=3600.0,
            contents=[PPContents(item=1, description="Optical equipment", actmass=52.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="FREEWB0047", origin=_CPT, destination=_JHB,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=18, weight_kg=815.0,
            declared_value=44300.0,
            contents=[PPContents(item=1, description="Furniture flat-packs", actmass=815.0, pieces=18)],
        ),
        _routed_waybill(
            waybill="FREEWB0048", origin=_BFN, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=12, weight_kg=505.0,
            declared_value=28100.0,
            contents=[PPContents(item=1, description="Solar panel components", actmass=505.0, pieces=12)],
        ),
        _routed_waybill(
            waybill="FREEWB0049", origin=_JHB, destination=_CPT,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=23, weight_kg=1020.0,
            declared_value=55800.0,
            contents=[PPContents(item=1, description="Packaged snacks", actmass=890.0, pieces=19),
                      PPContents(item=2, description="Point-of-sale displays", actmass=130.0, pieces=4)],
        ),
        _routed_waybill(
            waybill="FREEWB0050", origin=_CPT, destination=_BFN,
            manifest=UNASSIGNED_MANIFEST_NUMBER, parcel_count=8, weight_kg=210.0,
            declared_value=13500.0,
            contents=[PPContents(item=1, description="Musical instruments", actmass=210.0, pieces=8)],
        ),
    ]
}

MOCK_WAYBILLS.update(UNASSIGNED_WAYBILLS)
