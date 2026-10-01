"""The mocked PP manifest — an assumed data contract (FP-281, spec §8)."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import (
    MANIFEST_HAPPY_PATH,
    MANIFEST_NO_WAYBILLS,
    MANIFEST_OPEN_NO_TIMES,
    MockParcelPerfectClient,
    ParcelPerfectClient,
    PPManifestNotFoundError,
    PPUnsupportedError,
    parse_pp_datetime,
)
from tests.conftest import FakeMockStateStore


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(pp_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    return fake


@pytest.fixture
def today(monkeypatch: pytest.MonkeyPatch) -> date:
    pinned = datetime.now(pp_module.pp_timezone()).date()
    monkeypatch.setattr(pp_module, "_operations_today", lambda: pinned)
    return pinned


def test_pp_times_are_read_as_south_african_time() -> None:
    parsed = parse_pp_datetime("01.10.2026 20:00")

    assert parsed == datetime(2026, 10, 1, 18, 0, tzinfo=UTC)


async def test_happy_path_manifest_is_complete(store: FakeMockStateStore, today: date) -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    header = manifest.header
    assert (header.issuer_account, header.origin_hub, header.destination_hub) == ("MOCK01", "CPT", "JNB")
    assert header.closed_at is not None
    assert header.planned_departure_at is not None
    assert header.planned_departure_at.tzinfo is not None
    assert header.planned_departure_at.astimezone(pp_module.pp_timezone()).date() == today
    assert [w.details.waybill for w in manifest.waybills] == ["MFTWB8101", "MFTWB8102", "MFTWB8103"]
    assert any("→" in note.text for note in header.notes)


async def test_open_manifest_has_no_times_and_no_close(store: FakeMockStateStore, today: date) -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_OPEN_NO_TIMES)

    assert manifest.header.closed_at is None
    assert manifest.header.planned_departure_at is None
    assert manifest.header.expected_arrival_at is None


async def test_manifest_without_waybills_returns_an_empty_list(store: FakeMockStateStore, today: date) -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_NO_WAYBILLS)

    assert manifest.waybills == []


async def test_unknown_manifest_raises_not_found(store: FakeMockStateStore, today: date) -> None:
    with pytest.raises(PPManifestNotFoundError):
        await MockParcelPerfectClient().get_manifest(99999)


async def test_mixed_client_manifest_70_keeps_its_two_accounts(store: FakeMockStateStore, today: date) -> None:
    manifest = await MockParcelPerfectClient().get_manifest(70)

    assert {w.details.accnum for w in manifest.waybills} == {"MOCK01", "UNMAP9"}


async def test_a_staged_waybill_move_changes_membership(store: FakeMockStateStore, today: date) -> None:
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("MFTWB8201", manifest=MANIFEST_HAPPY_PATH)

    manifest = await client.get_manifest(MANIFEST_HAPPY_PATH)

    assert "MFTWB8201" in [w.details.waybill for w in manifest.waybills]


async def test_staged_header_change_is_applied(store: FakeMockStateStore, today: date) -> None:
    client = MockParcelPerfectClient()
    departure = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=3)
    await client.stage_manifest_override(
        MANIFEST_OPEN_NO_TIMES, closed=True, planned_departure_at=departure,
    )

    header = (await client.get_manifest(MANIFEST_OPEN_NO_TIMES)).header

    assert header.closed_at is not None
    assert header.planned_departure_at == departure


async def test_staging_an_unknown_manifest_raises(store: FakeMockStateStore, today: date) -> None:
    with pytest.raises(PPManifestNotFoundError):
        await MockParcelPerfectClient().stage_manifest_override(99999, closed=True)


async def test_real_client_has_no_manifest_lookup() -> None:
    with pytest.raises(PPUnsupportedError):
        await ParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)


async def test_both_manifest_readers_apply_staged_membership_and_cargo(
    store: FakeMockStateStore, today: date,
) -> None:
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("MFTWB8201", manifest=MANIFEST_HAPPY_PATH, parcel_count=2)
    await client.stage_waybill_override("MFTWB8101", manifest=MANIFEST_OPEN_NO_TIMES)

    for number in (MANIFEST_HAPPY_PATH, MANIFEST_OPEN_NO_TIMES):
        manifest = await client.get_manifest(number)
        legacy = await client.get_waybills_by_manifest(number)
        assert legacy == manifest.waybills
    fresh = await client.get_single_waybill("MFTWB8201")
    assert len(fresh.tracks) == 2
    assert fresh in (await client.get_manifest(MANIFEST_HAPPY_PATH)).waybills
