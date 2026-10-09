"""Mock manifest fixtures (FP-281): the new manifest numbers, their waybills and header fixtures, and the renderer that turns a fixture into a PPManifestHeader."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from app.integrations.parcel_perfect.models import PPContents, PPManifestHeader, PPManifestNote, PPWaybillResponse
from app.integrations.parcel_perfect.timestamps import _PP_DATE_FORMAT, parse_pp_datetime
from app.integrations.parcel_perfect.waybill_fixtures import (
    MOCK_WAYBILLS,
    _CPT,
    _DEMO_PP_ACCOUNT,
    _DEMO_PP_CUSTOMER,
    _HUB_DURBAN,
    _JHB,
    _MANIFEST_ACTIVE,
    _MANIFEST_CLOSED,
    _MANIFEST_SINGLE,
    _MANIFEST_XDOCK,
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


@dataclass(frozen=True)
class _PPTime:
    """A fixture time relative to today in PP's timezone. Demo manifests are always
    due today, because activation gates on the operating day."""

    day_offset: int
    hhmm: str


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
