"""Unit tests for the PP mock fixture library and manifest lookup."""
import pytest

from app.integrations.parcel_perfect import (
    MOCK_WAYBILLS,
    MockParcelPerfectClient,
    ParcelPerfectClient,
    PPUnsupportedError,
    PPWaybillNotFoundError,
)


async def test_known_reference_returns_fixture():
    client = MockParcelPerfectClient()

    result = await client.get_single_waybill("WAY001")

    assert result.details.waybill == "WAY001"
    assert result.details.accnum == "MOCK01"


async def test_unknown_reference_raises_not_found():
    client = MockParcelPerfectClient()

    with pytest.raises(PPWaybillNotFoundError):
        await client.get_single_waybill("NOPE999")


async def test_manifest_lookup_groups_fixtures():
    client = MockParcelPerfectClient()

    result = await client.get_waybills_by_manifest(69)

    assert [w.details.waybill for w in result] == ["MOCKWAY001", "WAY001", "WAY002", "WAY003"]


async def test_manifest_lookup_unknown_number_returns_empty():
    client = MockParcelPerfectClient()

    assert await client.get_waybills_by_manifest(9999) == []


async def test_real_client_manifest_lookup_unsupported():
    client = ParcelPerfectClient()

    with pytest.raises(PPUnsupportedError):
        await client.get_waybills_by_manifest(69)


def test_capability_flags():
    assert MockParcelPerfectClient.supports_manifest_lookup is True
    assert ParcelPerfectClient.supports_manifest_lookup is False


def test_every_fixture_has_tracks_matching_pieces():
    for ref, w in MOCK_WAYBILLS.items():
        assert len(w.tracks) == w.details.pieces, ref


def test_every_fixture_contents_pieces_sum_matches_details():
    for ref, w in MOCK_WAYBILLS.items():
        assert sum(c.pieces for c in w.contents) == w.details.pieces, ref
