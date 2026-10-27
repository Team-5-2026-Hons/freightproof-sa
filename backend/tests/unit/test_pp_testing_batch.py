"""The PP mock's testing batch: 50 waybills on manifests 84-98, each a trip the wizard can create.

These fixtures only earn their place if every manifest previews clean. A batch
manifest that collides with an existing number, or whose hub has no demo
precinct, would produce a blocking or prompting warning, so it would be a fixture
that silently cannot become a trip.
"""

from datetime import date, datetime

import pytest

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import mock as pp_mock_module
from app.integrations.parcel_perfect import (
    DEMO_HUB_CODES,
    MANIFEST_DEMO_WAYBILLS,
    MOCK_WAYBILLS,
    SEEDED_WAYBILLS,
    UNASSIGNED_WAYBILLS,
    MockParcelPerfectClient,
)
from app.integrations.parcel_perfect.manifest_fixtures import (
    TESTING_BATCH_MANIFESTS,
    TESTING_BATCH_WAYBILLS,
)
from tests.conftest import FakeMockStateStore

EXPECTED_BATCH_SIZE = 50


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


def test_testing_batch_has_fifty_waybills() -> None:
    total_lines = sum(len(m.lines) for m in TESTING_BATCH_MANIFESTS.values())

    assert len(TESTING_BATCH_WAYBILLS) == EXPECTED_BATCH_SIZE
    assert total_lines == EXPECTED_BATCH_SIZE


def test_testing_batch_references_collide_with_no_other_fixture() -> None:
    others = set(SEEDED_WAYBILLS) | set(UNASSIGNED_WAYBILLS) | set(MANIFEST_DEMO_WAYBILLS)

    assert not others & set(TESTING_BATCH_WAYBILLS)
    assert all(MOCK_WAYBILLS[ref] is waybill for ref, waybill in TESTING_BATCH_WAYBILLS.items())


def test_testing_batch_manifests_hold_only_their_own_waybills() -> None:
    batch_numbers = set(TESTING_BATCH_MANIFESTS)

    strays = [
        ref for ref, waybill in MOCK_WAYBILLS.items()
        if waybill.details.manifest in batch_numbers and ref not in TESTING_BATCH_WAYBILLS
    ]

    assert strays == []


def test_testing_batch_waybills_state_their_manifests_route() -> None:
    for waybill in TESTING_BATCH_WAYBILLS.values():
        assert waybill.details.manifest is not None
        manifest = TESTING_BATCH_MANIFESTS[waybill.details.manifest]

        assert waybill.details.orig_town == manifest.origin.town
        assert waybill.details.dest_town == manifest.destination.town
        assert waybill.details.pieces == len(waybill.tracks)


@pytest.mark.parametrize("manifest_number", sorted(TESTING_BATCH_MANIFESTS))
async def test_testing_batch_manifest_is_closed_timed_and_linked(
    store: FakeMockStateStore, today: date, manifest_number: int,
) -> None:
    fixture = TESTING_BATCH_MANIFESTS[manifest_number]

    manifest = await MockParcelPerfectClient().get_manifest(manifest_number)

    header = manifest.header
    assert header.issuer_account == "MOCK01"
    assert {header.origin_hub, header.destination_hub} <= DEMO_HUB_CODES
    assert header.origin_hub != header.destination_hub
    assert header.closed_at is not None
    assert header.planned_departure_at is not None
    assert header.expected_arrival_at is not None
    assert header.planned_departure_at.astimezone(pp_module.pp_timezone()).date() == today
    assert len(manifest.waybills) == len(fixture.lines)
    assert all(w.details.accnum == header.issuer_account for w in manifest.waybills)
