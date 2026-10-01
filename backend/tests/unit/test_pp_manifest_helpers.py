"""Pure manifest helpers (FP-281, spec §8–§9): snapshot, hash, totals, client check."""

import copy
import json
from datetime import datetime

import pytest

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import MANIFEST_HAPPY_PATH, MockParcelPerfectClient, PPTrack
from app.orchestration.pp_manifest import (
    manifest_key,
    manifest_snapshot,
    manifest_snapshot_sha256,
    manifest_totals,
    waybills_from_other_clients,
)


@pytest.fixture(autouse=True)
def pinned_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    pinned = datetime.now(pp_module.pp_timezone()).date()
    monkeypatch.setattr(pp_module, "_operations_today", lambda: pinned)


async def test_snapshot_survives_a_json_round_trip() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    snapshot = manifest_snapshot(manifest)

    assert json.loads(json.dumps(snapshot)) == snapshot


async def test_hash_ignores_waybill_order() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    reordered = copy.deepcopy(manifest)
    reordered.waybills.reverse()

    assert manifest_snapshot_sha256(manifest) == manifest_snapshot_sha256(reordered)


async def test_hash_changes_when_a_waybill_changes() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    changed = copy.deepcopy(manifest)
    changed.waybills[0].tracks.append(PPTrack(trackno="EXTRA0001", parcelno=99, item=1))

    assert manifest_snapshot_sha256(manifest) != manifest_snapshot_sha256(changed)


async def test_hash_changes_when_the_header_changes() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    reopened = copy.deepcopy(manifest)
    reopened.header.closed_at = None

    assert manifest_snapshot_sha256(manifest) != manifest_snapshot_sha256(reopened)


async def test_totals_are_computed_from_the_waybills() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    totals = manifest_totals(manifest)

    assert (totals.waybills, totals.parcels, totals.weight_kg) == (3, 20, 875.5)


async def test_manifest_key() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    assert manifest_key(manifest) == ("MOCK01", "CPT", MANIFEST_HAPPY_PATH)


async def test_other_client_waybills_are_named() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(70)

    assert waybills_from_other_clients(manifest) == ["WAY004"]


async def test_single_client_manifest_has_none() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    assert waybills_from_other_clients(manifest) == []
