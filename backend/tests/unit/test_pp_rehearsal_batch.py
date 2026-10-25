"""The PP mock's rehearsal batch: 30 clean manifests (101-130), 24 local and 6 national.

The batch only earns its place if it is exactly what a presenter expects at the lectern:
the right routes, numbers and barcodes that collide with nothing already in the fixture
library, cargo that starts untouched, and a header whose hubs agree with its waybills. The
mock stores fixtures in plain dicts, so a clash would silently overwrite rather than fail.
"""

from collections import Counter
from datetime import date, datetime

import pytest

from app.core.config import settings
from app.core.constants import MINIMUM_TRIP_DURATION
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import mock as pp_mock_module
from app.integrations.parcel_perfect import (
    DEMO_HUB_CODES,
    MOCK_MANIFEST_HEADERS,
    MOCK_WAYBILLS,
    MockParcelPerfectClient,
)
from app.integrations.parcel_perfect.manifest_fixtures import (
    REHEARSAL_BATCH_MANIFESTS,
    REHEARSAL_BATCH_WAYBILLS,
)
from app.integrations.parcel_perfect.waybill_fixtures import (
    LOCAL_HUB_CODES,
    _BFN,
    _CAVENDISH,
    _CPT,
    _JHB,
    _UCT_NORTH,
    _UCT_SOUTH,
)
from app.orchestration.consignments.manifest_snapshot import manifest_snapshot_sha256
from tests.conftest import FakeMockStateStore

EXPECTED_BATCH_SIZE = 30
FIRST_NUMBER, LAST_NUMBER = 101, 130
LOCAL_PER_ROUTE = 6
MAX_WAYBILLS_PER_MANIFEST = 4
# "Small enough to demonstrate with a few cartons on a table."
SMALL_MANIFEST_PARCELS = 6
MIN_SMALL_LOCAL_MANIFESTS = 8
MAX_LOCAL_MANIFEST_PARCELS = 20
MAX_NATIONAL_MANIFEST_PARCELS = 20

_DEPOTS_BY_HUB = {d.hub_code: d for d in (_CAVENDISH, _UCT_NORTH, _UCT_SOUTH, _CPT, _BFN, _JHB)}

# The order the brief lists them in; the national manifests are 125-130.
_EXPECTED_ROUTES: list[tuple[str, str, int]] = [
    ("CAV", "UCN", 6), ("UCN", "CAV", 6), ("UCS", "UCN", 6), ("UCN", "UCS", 6),
    ("CPT", "JNB", 1), ("JNB", "CPT", 1), ("CPT", "BFN", 1),
    ("BFN", "CPT", 1), ("BFN", "JNB", 1), ("JNB", "BFN", 1),
]


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(pp_mock_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    return fake


@pytest.fixture
def today(monkeypatch: pytest.MonkeyPatch) -> date:
    pinned = datetime.now(pp_module.pp_timezone()).date()
    monkeypatch.setattr(pp_mock_module, "_operations_today", lambda: pinned)
    return pinned


def _is_local(number: int) -> bool:
    return {REHEARSAL_BATCH_MANIFESTS[number].origin.hub_code,
            REHEARSAL_BATCH_MANIFESTS[number].destination.hub_code} <= LOCAL_HUB_CODES


def _parcels(number: int) -> int:
    return sum(line.parcel_count for line in REHEARSAL_BATCH_MANIFESTS[number].lines)


def _barcodes(waybills: dict) -> list[str]:
    return [t.trackno for w in waybills.values() for t in w.tracks]


def test_batch_is_exactly_thirty_manifests_numbered_101_to_130() -> None:
    assert len(REHEARSAL_BATCH_MANIFESTS) == EXPECTED_BATCH_SIZE
    assert sorted(REHEARSAL_BATCH_MANIFESTS) == list(range(FIRST_NUMBER, LAST_NUMBER + 1))


def test_batch_route_distribution_matches_the_brief() -> None:
    routes = Counter(
        (m.origin.hub_code, m.destination.hub_code) for m in REHEARSAL_BATCH_MANIFESTS.values()
    )

    assert routes == Counter({(o, d): n for o, d, n in _EXPECTED_ROUTES})
    assert sum(1 for n in REHEARSAL_BATCH_MANIFESTS if _is_local(n)) == 24
    assert sum(1 for n in REHEARSAL_BATCH_MANIFESTS if not _is_local(n)) == 6


def test_batch_routes_sit_on_consecutive_numbers_in_the_briefs_order() -> None:
    order = [
        (REHEARSAL_BATCH_MANIFESTS[n].origin.hub_code, REHEARSAL_BATCH_MANIFESTS[n].destination.hub_code)
        for n in sorted(REHEARSAL_BATCH_MANIFESTS)
    ]

    expected = [(o, d) for o, d, count in _EXPECTED_ROUTES for _ in range(count)]
    assert order == expected


def test_manifest_numbers_collide_with_no_existing_header() -> None:
    others = set(MOCK_MANIFEST_HEADERS) - set(REHEARSAL_BATCH_MANIFESTS)

    assert not others & set(REHEARSAL_BATCH_MANIFESTS)
    # Everything before 101 was taken or deliberately skipped; nothing sits inside the range.
    assert max(others) < FIRST_NUMBER


def test_waybill_references_are_unique_and_new() -> None:
    others = set(MOCK_WAYBILLS) - set(REHEARSAL_BATCH_WAYBILLS)
    total_lines = sum(len(m.lines) for m in REHEARSAL_BATCH_MANIFESTS.values())

    assert len(REHEARSAL_BATCH_WAYBILLS) == total_lines
    assert not others & set(REHEARSAL_BATCH_WAYBILLS)
    # MOCK_WAYBILLS is a dict: a clash would have overwritten, so check identity survived.
    assert all(MOCK_WAYBILLS[ref] is w for ref, w in REHEARSAL_BATCH_WAYBILLS.items())


def test_parcel_barcodes_are_unique_and_new() -> None:
    mine = _barcodes(REHEARSAL_BATCH_WAYBILLS)
    others = _barcodes({r: w for r, w in MOCK_WAYBILLS.items() if r not in REHEARSAL_BATCH_WAYBILLS})

    assert len(mine) == len(set(mine))
    assert not set(mine) & set(others)


def test_each_manifest_holds_exactly_its_own_waybills() -> None:
    for number, fixture in REHEARSAL_BATCH_MANIFESTS.items():
        held = sorted(ref for ref, w in MOCK_WAYBILLS.items() if w.details.manifest == number)

        assert held == [f"MFTWB{number}{position:02d}" for position in range(1, len(fixture.lines) + 1)]
        assert 1 <= len(held) <= MAX_WAYBILLS_PER_MANIFEST


def test_waybill_counts_vary_across_one_to_four() -> None:
    counts = {len(m.lines) for m in REHEARSAL_BATCH_MANIFESTS.values()}

    assert counts == {1, 2, 3, 4}


def test_parcel_totals_are_manageable_and_several_are_small() -> None:
    local = [n for n in REHEARSAL_BATCH_MANIFESTS if _is_local(n)]
    national = [n for n in REHEARSAL_BATCH_MANIFESTS if not _is_local(n)]

    assert all(_parcels(n) <= MAX_LOCAL_MANIFEST_PARCELS for n in local)
    assert all(_parcels(n) <= MAX_NATIONAL_MANIFEST_PARCELS for n in national)
    assert sum(1 for n in local if _parcels(n) <= SMALL_MANIFEST_PARCELS) >= MIN_SMALL_LOCAL_MANIFESTS


def test_waybill_pieces_weights_and_contents_agree() -> None:
    for waybill in REHEARSAL_BATCH_WAYBILLS.values():
        assert waybill.details.pieces == len(waybill.tracks)
        assert [t.parcelno for t in waybill.tracks] == list(range(1, waybill.details.pieces + 1))
        assert sum(c.pieces for c in waybill.contents) == waybill.details.pieces
        assert sum(c.actmass for c in waybill.contents) == waybill.details.actual_weight_kg
        assert all(t.trackno.startswith(waybill.details.waybill) for t in waybill.tracks)


def test_cargo_starts_clean() -> None:
    for waybill in REHEARSAL_BATCH_WAYBILLS.values():
        assert waybill.details.poddate == ""
        assert waybill.details.failtype is None
        assert not waybill.is_delivered
        assert not waybill.has_delivery_failure
        assert waybill.wayrefs == []
        assert waybill.details.accnum == "MOCK01"


def test_waybill_routes_agree_with_the_header_hubs() -> None:
    for number, fixture in REHEARSAL_BATCH_MANIFESTS.items():
        header = MOCK_MANIFEST_HEADERS[number]
        origin, destination = _DEPOTS_BY_HUB[header.origin_hub], _DEPOTS_BY_HUB[header.destination_hub]

        assert (origin, destination) == (fixture.origin, fixture.destination)
        for waybill in (MOCK_WAYBILLS[f"MFTWB{number}{p:02d}"] for p in range(1, len(fixture.lines) + 1)):
            assert (waybill.details.orig_town, waybill.details.orig_address) == (origin.town, origin.address)
            assert (waybill.details.dest_town, waybill.details.dest_address) == (
                destination.town, destination.address,
            )
            assert waybill.details.dest_person == destination.contact_person


def test_hubs_are_never_the_same_and_local_hubs_stay_unlinked() -> None:
    for number in REHEARSAL_BATCH_MANIFESTS:
        header = MOCK_MANIFEST_HEADERS[number]
        hubs = {header.origin_hub, header.destination_hub}

        assert len(hubs) == 2
        # Local hubs must never be mistaken for seeded national depots, and a route is
        # wholly local or wholly national.
        assert hubs <= LOCAL_HUB_CODES or hubs <= DEMO_HUB_CODES
    assert not LOCAL_HUB_CODES & DEMO_HUB_CODES


@pytest.mark.parametrize("number", sorted(REHEARSAL_BATCH_MANIFESTS))
async def test_manifest_is_closed_timed_single_client_and_today(
    store: FakeMockStateStore, today: date, number: int,
) -> None:
    fixture = REHEARSAL_BATCH_MANIFESTS[number]

    manifest = await MockParcelPerfectClient().get_manifest(number)

    header = manifest.header
    assert header.issuer_account == "MOCK01"
    assert header.client_reference == f"PO-CGY-{number:04d}"
    assert len(manifest.waybills) == len(fixture.lines)
    assert {w.details.accnum for w in manifest.waybills} == {header.issuer_account}
    assert header.closed_at is not None and header.planned_departure_at is not None
    assert header.expected_arrival_at is not None
    assert header.created_at <= header.closed_at <= header.planned_departure_at
    assert header.expected_arrival_at - header.planned_departure_at >= MINIMUM_TRIP_DURATION
    assert header.planned_departure_at.astimezone(pp_module.pp_timezone()).date() == today


async def test_local_manifests_run_the_same_morning_leg(store: FakeMockStateStore, today: date) -> None:
    for number in (n for n in REHEARSAL_BATCH_MANIFESTS if _is_local(n)):
        header = (await MockParcelPerfectClient().get_manifest(number)).header
        zone = pp_module.pp_timezone()

        # Both are Optional on PPManifestHeader; a local leg is only meaningful once the
        # fixture has set them, so a None here is a fixture fault, not a schedule mismatch.
        assert header.planned_departure_at is not None
        assert header.expected_arrival_at is not None
        assert header.planned_departure_at.astimezone(zone).strftime("%H:%M") == "09:00"
        assert header.expected_arrival_at.astimezone(zone).strftime("%H:%M") == "09:45"
        assert header.expected_arrival_at.astimezone(zone).date() == today


async def test_manifest_snapshot_is_stable_between_two_lookups(store: FakeMockStateStore, today: date) -> None:
    client = MockParcelPerfectClient()

    first = manifest_snapshot_sha256(await client.get_manifest(101))
    second = manifest_snapshot_sha256(await client.get_manifest(101))

    assert first == second


async def test_batch_is_reachable_through_the_waybill_and_staging_controls(
    store: FakeMockStateStore, today: date,
) -> None:
    client = MockParcelPerfectClient()

    waybill = await client.get_single_waybill("MFTWB10101")
    await client.stage_manifest_override(101, closed=False)
    await client.stage_waybill_override("MFTWB10101", parcel_count=3)

    staged = await client.get_single_waybill("MFTWB10101")
    assert waybill.details.pieces == 2 and staged.details.pieces == 3
    assert (await client.get_manifest(101)).header.closed_at is None
    # Staging is per manifest: a neighbour is untouched.
    assert (await client.get_manifest(102)).header.closed_at is not None
