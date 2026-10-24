"""Mock manifest fixtures (FP-281): the new manifest numbers, their waybills and header fixtures, and the renderer that turns a fixture into a PPManifestHeader."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from app.integrations.parcel_perfect.models import PPContents, PPManifestHeader, PPManifestNote, PPWaybillResponse
from app.integrations.parcel_perfect.timestamps import _PP_DATE_FORMAT, parse_pp_datetime
from app.integrations.parcel_perfect.waybill_fixtures import (
    MOCK_WAYBILLS,
    _BFN,
    _CAVENDISH,
    _CPT,
    _DEMO_PP_ACCOUNT,
    _DEMO_PP_CUSTOMER,
    _HUB_DURBAN,
    _JHB,
    _MANIFEST_ACTIVE,
    _MANIFEST_CLOSED,
    _MANIFEST_SINGLE,
    _MANIFEST_XDOCK,
    _UCT_NORTH,
    _UCT_SOUTH,
    _Depot,
    _routed_waybill,
)


# ---------------------------------------------------------------------------
# Manifest-first fixtures (FP-281). New numbers only: 69/70's waybills are asserted
# by existing tests and are not modified — they only gain a header.
# ---------------------------------------------------------------------------

MANIFEST_HAPPY_PATH = 81
MANIFEST_OPEN_NO_TIMES = 82
MANIFEST_NO_WAYBILLS = 83

MANIFEST_DEMO_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        _routed_waybill(
            waybill="MFTWB8101", origin=_CPT, destination=_JHB,
            manifest=MANIFEST_HAPPY_PATH, parcel_count=6, weight_kg=240.0, declared_value=15800.0,
            contents=[PPContents(item=1, description="Boxed electronics", actmass=240.0, pieces=6)],
        ),
        _routed_waybill(
            waybill="MFTWB8102", origin=_CPT, destination=_JHB,
            manifest=MANIFEST_HAPPY_PATH, parcel_count=4, weight_kg=180.5, declared_value=9200.0,
            contents=[PPContents(item=1, description="Pharmaceutical cartons", actmass=180.5, pieces=4)],
        ),
        _routed_waybill(
            waybill="MFTWB8103", origin=_CPT, destination=_JHB,
            manifest=MANIFEST_HAPPY_PATH, parcel_count=10, weight_kg=455.0, declared_value=21400.0,
            contents=[PPContents(item=1, description="Retail FMCG cartons", actmass=455.0, pieces=10)],
        ),
        _routed_waybill(
            waybill="MFTWB8201", origin=_CPT, destination=_JHB,
            manifest=MANIFEST_OPEN_NO_TIMES, parcel_count=3, weight_kg=96.0, declared_value=4100.0,
            contents=[PPContents(item=1, description="Spare parts", actmass=96.0, pieces=3)],
        ),
        _routed_waybill(
            waybill="MFTWB8202", origin=_CPT, destination=_JHB,
            manifest=MANIFEST_OPEN_NO_TIMES, parcel_count=8, weight_kg=310.0, declared_value=12800.0,
            contents=[PPContents(item=1, description="Homeware cartons", actmass=310.0, pieces=8)],
        ),
    ]
}

MOCK_WAYBILLS.update(MANIFEST_DEMO_WAYBILLS)


# ---------------------------------------------------------------------------
# Testing batch: 50 waybills on 15 closed, timed manifests (84-98).
#
# The wizard is manifest-first and a manifest is spent once it is on a live trip, so
# 81 alone gives one test trip and then every lookup is MANIFEST_ALREADY_ON_TRIP.
# These are for spending freely in dev; keep 81 for the walkthrough. Most leave
# Cape Town because that is where activation is tested on a real phone. The other
# routes are there so non-CPT origins are exercised too.
#
# Waybill numbers follow 81's pattern: MFTWB + manifest number + line on the manifest.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _BatchLine:
    parcel_count: int
    weight_kg: float
    declared_value: float
    description: str


@dataclass(frozen=True)
class _BatchManifest:
    origin: _Depot
    destination: _Depot
    lines: tuple[_BatchLine, ...]


TESTING_BATCH_MANIFESTS: dict[int, _BatchManifest] = {
    84: _BatchManifest(_CPT, _JHB, (
        _BatchLine(5, 210.0, 12400.0, "Boxed small appliances"),
    )),
    85: _BatchManifest(_CPT, _JHB, (
        _BatchLine(9, 380.0, 21600.0, "Retail apparel cartons"),
        _BatchLine(3, 72.0, 8900.0, "Mobile handsets"),
    )),
    86: _BatchManifest(_CPT, _BFN, (
        _BatchLine(12, 540.0, 26800.0, "Canned fruit"),
        _BatchLine(4, 96.0, 5200.0, "Stationery cartons"),
        _BatchLine(7, 310.0, 15100.0, "Garden tools"),
    )),
    87: _BatchManifest(_CPT, _JHB, (
        _BatchLine(6, 245.0, 14700.0, "Wine cases"),
        _BatchLine(10, 455.0, 23900.0, "Bottled sauces"),
        _BatchLine(2, 38.0, 6100.0, "Pharmaceutical samples"),
        _BatchLine(8, 330.0, 18200.0, "Bedding sets"),
    )),
    88: _BatchManifest(_CPT, _BFN, (
        _BatchLine(14, 620.0, 30500.0, "Dried fruit cartons"),
        _BatchLine(5, 140.0, 9600.0, "Printer consumables"),
        _BatchLine(3, 64.0, 7300.0, "Laboratory glassware"),
        _BatchLine(9, 395.0, 19800.0, "Pet food bags"),
        _BatchLine(6, 220.0, 11500.0, "Bathroom fittings"),
    )),
    89: _BatchManifest(_CPT, _JHB, (
        _BatchLine(11, 490.0, 27300.0, "Flat-pack furniture"),
        _BatchLine(4, 88.0, 6400.0, "Cosmetics cartons"),
        _BatchLine(16, 730.0, 36900.0, "Bottled juice pallets"),
        _BatchLine(7, 260.0, 15800.0, "Sports equipment"),
        _BatchLine(2, 45.0, 11200.0, "Camera equipment"),
        _BatchLine(8, 350.0, 17400.0, "Kitchenware cartons"),
    )),
    90: _BatchManifest(_CPT, _JHB, (
        _BatchLine(13, 585.0, 29100.0, "Paper towels"),
        _BatchLine(5, 175.0, 10800.0, "Electrical cable drums"),
        _BatchLine(3, 59.0, 4700.0, "Spectacle frames"),
    )),
    91: _BatchManifest(_CPT, _BFN, (
        _BatchLine(10, 440.0, 22300.0, "Bagged maize meal"),
        _BatchLine(6, 205.0, 13600.0, "Power tools"),
        _BatchLine(4, 115.0, 7900.0, "School textbooks"),
        _BatchLine(8, 360.0, 16700.0, "Detergent cartons"),
    )),
    92: _BatchManifest(_CPT, _JHB, (
        _BatchLine(7, 290.0, 20400.0, "Solar inverters"),
        _BatchLine(12, 515.0, 25500.0, "Ceramic dinnerware"),
    )),
    93: _BatchManifest(_BFN, _JHB, (
        _BatchLine(15, 690.0, 33200.0, "Sunflower oil cases"),
        _BatchLine(4, 92.0, 6800.0, "Veterinary medicines"),
        _BatchLine(9, 410.0, 19300.0, "Fencing wire coils"),
        _BatchLine(6, 230.0, 12100.0, "Leather goods"),
        _BatchLine(3, 70.0, 5900.0, "Seed packets"),
    )),
    94: _BatchManifest(_JHB, _CPT, (
        _BatchLine(8, 340.0, 24600.0, "Computer monitors"),
        _BatchLine(11, 470.0, 22800.0, "Engine oil cases"),
        _BatchLine(5, 150.0, 9100.0, "Medical gloves"),
    )),
    95: _BatchManifest(_BFN, _CPT, (
        _BatchLine(13, 600.0, 28700.0, "Bagged wheat flour"),
        _BatchLine(7, 275.0, 14300.0, "Saddlery goods"),
        _BatchLine(3, 66.0, 5400.0, "Irrigation fittings"),
        _BatchLine(10, 450.0, 21200.0, "Canned vegetables"),
    )),
    96: _BatchManifest(_JHB, _BFN, (
        _BatchLine(6, 215.0, 17900.0, "Networking switches"),
        _BatchLine(9, 400.0, 18600.0, "Paint tins"),
    )),
    97: _BatchManifest(_BFN, _JHB, (
        _BatchLine(14, 640.0, 31800.0, "Bagged animal feed"),
        _BatchLine(5, 160.0, 10200.0, "Farm hardware"),
        _BatchLine(2, 41.0, 3800.0, "Soil sample kits"),
    )),
    98: _BatchManifest(_JHB, _CPT, (
        _BatchLine(10, 465.0, 24100.0, "Mining safety gear"),
        _BatchLine(4, 105.0, 13400.0, "Audio equipment"),
        _BatchLine(7, 300.0, 15600.0, "Upholstery fabric rolls"),
    )),
}

TESTING_BATCH_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        _routed_waybill(
            waybill=f"MFTWB{number}{position:02d}",
            origin=manifest.origin, destination=manifest.destination, manifest=number,
            parcel_count=line.parcel_count, weight_kg=line.weight_kg,
            declared_value=line.declared_value,
            contents=[PPContents(item=1, description=line.description,
                                 actmass=line.weight_kg, pieces=line.parcel_count)],
        )
        for number, manifest in TESTING_BATCH_MANIFESTS.items()
        for position, line in enumerate(manifest.lines, start=1)
    ]
}

MOCK_WAYBILLS.update(TESTING_BATCH_WAYBILLS)


@dataclass(frozen=True)
class _PPTime:
    """A fixture time relative to today in PP's timezone. Demo manifests are always
    due today, because activation gates on the operating day."""

    day_offset: int
    hhmm: str


# ---------------------------------------------------------------------------
# Rehearsal batch: 30 clean manifests (101-130) for rehearsing the demo.
#
# 24 local (Cavendish, UCT North Stop, UCT South Stop), small enough to carry by hand,
# and 6 national between the three seeded depots. Every manifest starts with clean cargo:
# no POD, failure or scans, and nothing here creates a trip. Happy and unhappy runs come
# from the real driver flow and the dev triggers panel, so this file records no outcome.
#
# Waybills follow the testing batch's pattern, MFTWB + manifest number + line, which at
# three digits gives ten characters and cannot collide with the nine of 81-98.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _RehearsalSchedule:
    created: _PPTime
    closed: _PPTime
    departs: _PPTime
    arrives: _PPTime


@dataclass(frozen=True)
class _RehearsalManifest:
    origin: _Depot
    destination: _Depot
    lines: tuple[_BatchLine, ...]
    schedule: _RehearsalSchedule


# Local legs are minutes, not a night: depart 09:00, arrive 09:45, all today. Identical on
# every local manifest so the start-in-order rule (earlier departure first, same driver,
# same day) never decides the rehearsal order; activation itself only needs today's date.
_LOCAL_SCHEDULE = _RehearsalSchedule(
    _PPTime(0, "07:00"), _PPTime(0, "08:15"), _PPTime(0, "09:00"), _PPTime(0, "09:45"),
)


def _overnight(arrives: str) -> _RehearsalSchedule:
    """The existing national shape (created 12:00, closed 16:30, leaves 20:00) with a
    drive time that fits the road: the next morning, at `arrives`."""
    return _RehearsalSchedule(_PPTime(0, "12:00"), _PPTime(0, "16:30"), _PPTime(0, "20:00"), _PPTime(1, arrives))


_CPT_JNB_SCHEDULE = _overnight("11:00")   # about 15 h
_CPT_BFN_SCHEDULE = _overnight("07:00")   # about 11 h
_BFN_JNB_SCHEDULE = _overnight("01:30")   # about 5.5 h


def _run(
    first_number: int,
    origin: _Depot,
    destination: _Depot,
    schedule: _RehearsalSchedule,
    *manifests: tuple[_BatchLine, ...],
) -> dict[int, _RehearsalManifest]:
    """Consecutive manifest numbers on one route, one entry of `manifests` per number."""
    return {
        first_number + offset: _RehearsalManifest(origin, destination, lines, schedule)
        for offset, lines in enumerate(manifests)
    }


_L = _BatchLine  # (parcels, kg, declared value in rand, description)

REHEARSAL_BATCH_MANIFESTS: dict[int, _RehearsalManifest] = {
    # --- Local: 6 per direction, 1-4 waybills, 2-6 parcels a waybill ---------------------
    **_run(101, _CAVENDISH, _UCT_NORTH, _LOCAL_SCHEDULE,
        (_L(2, 14.0, 3200.0, "Stationery cartons"),),
        (_L(3, 21.5, 5800.0, "Prescribed textbooks"),),
        (_L(4, 38.0, 9400.0, "Lab coats and goggles"), _L(2, 9.0, 2100.0, "Calculator boxes")),
        (_L(5, 46.0, 7600.0, "Catering consumables"), _L(3, 18.0, 4300.0, "Printer toner")),
        (_L(6, 52.0, 12900.0, "Laptop accessories"), _L(2, 11.0, 3500.0, "First-aid kits"),
         _L(4, 33.0, 6200.0, "Residence bedding")),
        (_L(3, 24.0, 8800.0, "Tablet computers"), _L(5, 41.0, 5100.0, "Orientation packs"),
         _L(2, 12.5, 2600.0, "Name badge stock"), _L(4, 29.0, 6900.0, "Whiteboard supplies")),
    ),
    **_run(107, _UCT_NORTH, _CAVENDISH, _LOCAL_SCHEDULE,
        (_L(3, 19.0, 4700.0, "Returned textbooks"),),
        (_L(2, 8.0, 1800.0, "Printed posters"), _L(3, 15.0, 3900.0, "Merchandise returns")),
        (_L(2, 10.5, 2900.0, "Research sample kits"),),
        (_L(4, 31.0, 7400.0, "Event banners"), _L(2, 13.0, 2200.0, "Gift hampers"),
         _L(3, 22.0, 5600.0, "Catering crockery")),
        (_L(5, 44.0, 9100.0, "Surplus lab glassware"), _L(2, 9.5, 3300.0, "Camera kits")),
        (_L(3, 20.0, 4800.0, "Student newspapers"), _L(4, 34.0, 8200.0, "Sports kit"),
         _L(2, 11.0, 2700.0, "Art supplies"), _L(3, 26.0, 6100.0, "Conference packs")),
    ),
    **_run(113, _UCT_SOUTH, _UCT_NORTH, _LOCAL_SCHEDULE,
        (_L(3, 24.0, 5200.0, "Lab consumables"),),
        (_L(2, 17.0, 6400.0, "Network switches"),),
        (_L(4, 36.0, 7800.0, "Exam paper boxes"), _L(2, 12.0, 2400.0, "Lecture hall projectors"),
         _L(3, 21.0, 4900.0, "Cleaning supplies")),
        (_L(5, 43.0, 8700.0, "Library trolley stock"), _L(3, 19.5, 3600.0, "Art studio paint")),
        (_L(2, 15.0, 5900.0, "Microscope slides"), _L(4, 32.0, 6700.0, "Chemistry reagents")),
        (_L(3, 25.0, 4400.0, "Stage lighting"), _L(2, 14.0, 3100.0, "Choir risers"),
         _L(5, 40.0, 7200.0, "Sports equipment"), _L(2, 10.0, 2800.0, "Dining hall cutlery")),
    ),
    **_run(119, _UCT_NORTH, _UCT_SOUTH, _LOCAL_SCHEDULE,
        (_L(2, 13.0, 3700.0, "Departmental mail bags"),),
        (_L(3, 22.0, 5300.0, "Spare keyboards"), _L(2, 9.0, 1900.0, "Lab notebooks")),
        (_L(4, 35.0, 7100.0, "Furniture fittings"), _L(3, 20.0, 4600.0, "Gardening tools")),
        (_L(5, 47.0, 8300.0, "Surplus desktop computers"),),
        (_L(2, 11.5, 2300.0, "Security radios"), _L(3, 23.0, 5700.0, "Residence linen"),
         _L(4, 30.0, 6300.0, "Society banners")),
        (_L(3, 26.0, 5900.0, "Biology specimens"), _L(2, 16.0, 4100.0, "Drone cases"),
         _L(4, 33.0, 7500.0, "Gym equipment"), _L(3, 18.0, 3400.0, "Event signage")),
    ),
    # --- National: one per route, in the order the brief lists them ---------------------
    **_run(125, _CPT, _JHB, _CPT_JNB_SCHEDULE,
        (_L(6, 240.0, 15800.0, "Wine cartons"), _L(4, 150.0, 9600.0, "Skin-care cartons")),
    ),
    **_run(126, _JHB, _CPT, _CPT_JNB_SCHEDULE,
        (_L(5, 190.0, 11200.0, "Automotive spares"),),
    ),
    **_run(127, _CPT, _BFN, _CPT_BFN_SCHEDULE,
        (_L(8, 310.0, 17400.0, "Canned fish cartons"), _L(3, 72.0, 8600.0, "Pharmaceutical totes"),
         _L(5, 120.0, 6900.0, "Hardware sets")),
    ),
    **_run(128, _BFN, _CPT, _CPT_BFN_SCHEDULE,
        (_L(6, 205.0, 10400.0, "Biltong cartons"), _L(3, 85.0, 5300.0, "Agricultural sprayers")),
    ),
    **_run(129, _BFN, _JHB, _BFN_JNB_SCHEDULE,
        (_L(4, 98.0, 7200.0, "Veterinary supplies"),),
    ),
    **_run(130, _JHB, _BFN, _BFN_JNB_SCHEDULE,
        (_L(7, 260.0, 13800.0, "Mining consumables"), _L(2, 44.0, 6100.0, "Safety signage")),
    ),
}

REHEARSAL_BATCH_WAYBILLS: dict[str, PPWaybillResponse] = {
    w.details.waybill: w
    for w in [
        _routed_waybill(
            waybill=f"MFTWB{number}{position:02d}",
            origin=manifest.origin, destination=manifest.destination, manifest=number,
            parcel_count=line.parcel_count, weight_kg=line.weight_kg,
            declared_value=line.declared_value,
            contents=[PPContents(item=1, description=line.description,
                                 actmass=line.weight_kg, pieces=line.parcel_count)],
        )
        for number, manifest in REHEARSAL_BATCH_MANIFESTS.items()
        for position, line in enumerate(manifest.lines, start=1)
    ]
}

MOCK_WAYBILLS.update(REHEARSAL_BATCH_WAYBILLS)


@dataclass(frozen=True)
class _ManifestHeaderFixture:
    origin_hub: str
    destination_hub: str
    created: _PPTime
    closed: Optional[_PPTime]
    departure: Optional[_PPTime]
    arrival: Optional[_PPTime]
    issuer_account: str = _DEMO_PP_ACCOUNT
    issuer_name: str = _DEMO_PP_CUSTOMER
    client_reference: Optional[str] = None
    notes: tuple[tuple[_PPTime, str, str], ...] = ()


# Bruce, 28 Jul §9: the client creates the manifest around 12:00 on the day.
_CREATED = _PPTime(0, "12:00")
_CLOSED = _PPTime(0, "16:30")
_DEPARTS = _PPTime(0, "20:00")
_ARRIVES = _PPTime(1, "06:00")


def _closed_manifest(
    origin: str,
    destination: str,
    *,
    client_reference: Optional[str] = None,
    notes: tuple[tuple[_PPTime, str, str], ...] = (),
) -> _ManifestHeaderFixture:
    return _ManifestHeaderFixture(
        origin_hub=origin, destination_hub=destination, created=_CREATED, closed=_CLOSED,
        departure=_DEPARTS, arrival=_ARRIVES, client_reference=client_reference, notes=notes,
    )


MOCK_MANIFEST_HEADERS: dict[int, _ManifestHeaderFixture] = {
    # WAY001-003 + MOCKWAY001, all MOCK01. Durban has no demo precinct.
    69: _closed_manifest(_JHB.hub_code, _HUB_DURBAN),
    # WAY004 is UNMAP9, WAY005 is MOCK01: two clients on one manifest.
    70: _closed_manifest(_JHB.hub_code, _CPT.hub_code),
    # The four seeded trips (scripts/seed_trips.py), all leaving Cape Town.
    _MANIFEST_SINGLE: _closed_manifest(_CPT.hub_code, _JHB.hub_code),
    _MANIFEST_XDOCK: _closed_manifest(_CPT.hub_code, _JHB.hub_code),
    _MANIFEST_ACTIVE: _closed_manifest(_CPT.hub_code, _JHB.hub_code),
    _MANIFEST_CLOSED: _closed_manifest(_CPT.hub_code, _JHB.hub_code),
    MANIFEST_HAPPY_PATH: _closed_manifest(
        _CPT.hub_code, _JHB.hub_code, client_reference="PO-CGY-0081",
        notes=((_PPTime(0, "16:25"), "CGY Dispatch", "Kaapstad → Gauteng: two pallets shrink-wrapped together"),),
    ),
    # The 12:00 case: open, no vehicle yet, no times.
    MANIFEST_OPEN_NO_TIMES: _ManifestHeaderFixture(
        origin_hub=_CPT.hub_code, destination_hub=_JHB.hub_code, created=_CREATED,
        closed=None, departure=None, arrival=None,
    ),
    MANIFEST_NO_WAYBILLS: _closed_manifest(_CPT.hub_code, _JHB.hub_code),
}

# Closed and timed like 81, so each testing-batch manifest previews with no warnings.
MOCK_MANIFEST_HEADERS.update({
    number: _closed_manifest(
        manifest.origin.hub_code, manifest.destination.hub_code,
        client_reference=f"PO-CGY-{number:04d}",
    )
    for number, manifest in TESTING_BATCH_MANIFESTS.items()
})


# Closed and timed, so each rehearsal manifest previews with no warnings beyond the
# unlinked local hubs. The fixture's times are re-resolved against "today" on every
# lookup; the mock pins "today" per request, so a preview and the create that follows
# agree unless the clock crosses midnight between them.
MOCK_MANIFEST_HEADERS.update({
    number: _ManifestHeaderFixture(
        origin_hub=manifest.origin.hub_code, destination_hub=manifest.destination.hub_code,
        created=manifest.schedule.created, closed=manifest.schedule.closed,
        departure=manifest.schedule.departs, arrival=manifest.schedule.arrives,
        client_reference=f"PO-CGY-{number:04d}",
    )
    for number, manifest in REHEARSAL_BATCH_MANIFESTS.items()
})


def _render_pp_time(when: _PPTime, today: date) -> str:
    return f"{(today + timedelta(days=when.day_offset)).strftime(_PP_DATE_FORMAT)} {when.hhmm}"


def _build_header(number: int, fixture: _ManifestHeaderFixture, today: date) -> PPManifestHeader:
    """Render the fixture as PP would send it (date strings), then parse it back —
    so the mock exercises the same parser a live client would need."""

    def at(when: Optional[_PPTime]) -> Optional[datetime]:
        return parse_pp_datetime(_render_pp_time(when, today)) if when is not None else None

    return PPManifestHeader(
        manifest_number=number,
        issuer_account=fixture.issuer_account,
        issuer_name=fixture.issuer_name,
        origin_hub=fixture.origin_hub,
        destination_hub=fixture.destination_hub,
        created_at=parse_pp_datetime(_render_pp_time(fixture.created, today)),
        closed_at=at(fixture.closed),
        planned_departure_at=at(fixture.departure),
        expected_arrival_at=at(fixture.arrival),
        client_reference=fixture.client_reference,
        notes=[
            PPManifestNote(
                noted_at=parse_pp_datetime(_render_pp_time(when, today)),
                operator=operator, text=text,
            )
            for when, operator, text in fixture.notes
        ],
    )
