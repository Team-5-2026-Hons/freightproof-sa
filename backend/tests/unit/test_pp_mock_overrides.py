"""Unit tests for the dev-panel override layer on the PP mock.

Overrides exist so a staged waybill change is visible to the Celery worker, which
is a different process from the API and cannot see module-level mutation.
"""

import pytest

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import MockParcelPerfectClient, PPUnsupportedError
from tests.conftest import FakeMockStateStore


@pytest.fixture
def dev_panel_on(monkeypatch: pytest.MonkeyPatch) -> FakeMockStateStore:
    fake = FakeMockStateStore()
    monkeypatch.setattr(pp_module, "get_mock_state_store", lambda: fake)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", True)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    return fake


async def test_waybill_is_unchanged_when_nothing_staged(dev_panel_on):
    client = MockParcelPerfectClient()

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.poddate == ""
    assert waybill.details.failtype is None


async def test_staged_manifest_number_is_applied(dev_panel_on):
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", manifest=999)

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.manifest == 999


async def test_staged_poddate_is_applied(dev_panel_on):
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", poddate="04.08.2026")

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.poddate == "04.08.2026"


async def test_staged_failtype_is_applied(dev_panel_on):
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", failtype="Receiver not home")

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.failtype == "Receiver not home"


async def test_staged_parcel_count_grows_the_track_list(dev_panel_on):
    """Reproduces the verified 2026-08-04 finding: a portal edit grew tracks[]
    from 2 to 27 barcodes with no version, timestamp or audit field."""
    client = MockParcelPerfectClient()
    original = await client.get_single_waybill("WAY001")
    assert len(original.tracks) == 5

    await client.stage_waybill_override("WAY001", parcel_count=27)
    edited = await client.get_single_waybill("WAY001")

    assert len(edited.tracks) == 27
    assert edited.details.pieces == 27


async def test_overrides_are_ignored_when_the_dev_panel_is_off(
    monkeypatch: pytest.MonkeyPatch, dev_panel_on
):
    """The override lookup must not run — and must not touch Redis — in normal operation."""
    client = MockParcelPerfectClient()
    await client.stage_waybill_override("WAY001", manifest=999)
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)

    waybill = await client.get_single_waybill("WAY001")

    assert waybill.details.manifest == 69


async def test_staging_against_live_pp_is_refused(monkeypatch: pytest.MonkeyPatch, dev_panel_on):
    """Staging a fixture change while pointed at live PP is a bug, not a no-op."""
    monkeypatch.setattr(settings, "PP_USE_MOCK", False)
    client = MockParcelPerfectClient()

    with pytest.raises(PPUnsupportedError):
        await client.stage_waybill_override("WAY001", manifest=999)


async def test_staging_an_unknown_waybill_raises_not_found(dev_panel_on):
    from app.integrations.parcel_perfect import PPWaybillNotFoundError

    client = MockParcelPerfectClient()

    with pytest.raises(PPWaybillNotFoundError):
        await client.stage_waybill_override("NOPE-123", manifest=1)
