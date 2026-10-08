"""Pure manifest helpers (FP-281, spec §8–§9): snapshot, hash, display read, client check."""

import copy
import json
from datetime import datetime

import pytest

from app.core.config import settings
from app.integrations import parcel_perfect as pp_module
from app.integrations.parcel_perfect import mock as pp_mock_module
from app.integrations.parcel_perfect import MANIFEST_HAPPY_PATH, MockParcelPerfectClient, PPTrack
from app.orchestration.pp_manifest import (
    manifest_key,
    manifest_snapshot,
    manifest_snapshot_sha256,
    snapshot_read,
    waybills_from_other_clients,
)


@pytest.fixture(autouse=True)
def pinned_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEV_PANEL_ENABLED", False)
    monkeypatch.setattr(settings, "PP_USE_MOCK", True)
    pinned = datetime.now(pp_module.pp_timezone()).date()
    monkeypatch.setattr(pp_mock_module, "_operations_today", lambda: pinned)


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


async def test_snapshot_read_computes_lines_and_totals_from_the_waybills() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    shown = snapshot_read(manifest_snapshot(manifest))

    assert (shown.totals.waybills, shown.totals.parcels, shown.totals.weight_kg) == (3, 20, 875.5)
    assert [line.waybill for line in shown.waybills] == ["MFTWB8101", "MFTWB8102", "MFTWB8103"]
    assert sum(line.parcel_count for line in shown.waybills) == 20
    assert (shown.manifest_number, shown.origin_hub, shown.issuer_account) == (MANIFEST_HAPPY_PATH, "CPT", "MOCK01")


async def test_snapshot_read_is_the_same_after_a_jsonb_round_trip() -> None:
    # The manifest panel reads the snapshot back from JSONB; the preview reads it fresh.
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    snapshot = manifest_snapshot(manifest)

    assert snapshot_read(json.loads(json.dumps(snapshot))) == snapshot_read(snapshot)


async def test_snapshot_read_counts_an_unstated_weight_as_zero() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)
    snapshot = manifest_snapshot(manifest)
    first = snapshot["waybills"][0]
    unweighed = first["details"]["actual_weight_kg"]
    first["details"]["actual_weight_kg"] = None

    shown = snapshot_read(snapshot)

    assert shown.waybills[0].weight_kg is None
    assert shown.totals.weight_kg == round(875.5 - unweighed, 2)


async def test_manifest_key() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    assert manifest_key(manifest) == ("MOCK01", "CPT", MANIFEST_HAPPY_PATH)


async def test_other_client_waybills_are_named() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(70)

    assert waybills_from_other_clients(manifest) == ["WAY004"]


async def test_single_client_manifest_has_none() -> None:
    manifest = await MockParcelPerfectClient().get_manifest(MANIFEST_HAPPY_PATH)

    assert waybills_from_other_clients(manifest) == []
