"""Unit tests for the live Pulsit client and the mock/live factory switch.

FIXTURE PROVENANCE — read this before trusting any payload below.

These payloads were NOT recorded from the Pulsit API. Nothing here came off the
wire. Pulsit supplied no API specification and no credentials existed when this was
written, so there was nothing to record from — every payload is hand-built from the
shape this repository ASSUMES, which is documented in full at the top of
app/integrations/pulsit.py.

What these tests therefore prove, and what they do not:

  they DO prove — the client parses the assumed shape correctly, keeps decimal
    precision, and degrades honestly on a timeout, an HTTP error, an unreadable
    body and a device Pulsit does not report;
  they DO NOT prove — that the assumed shape is Pulsit's actual shape.

Stated plainly because this is an evidence platform and a fixture that quietly
implies it was captured from a live system is itself a small forgery. When the real
specification arrives, expect these payloads to change alongside _parse_position().

respx mocks httpx at the transport layer, so no real network call is made.
"""

import json
from decimal import Decimal

import httpx
import pytest
import respx

from app.core.config import settings
from app.integrations.pulsit import (
    LivePulsitClient,
    MockPulsitClient,
    PulsitFixSource,
    PulsitFixStatus,
    get_pulsit_client,
)

_PULSIT_BASE = "http://pulsit.test/api"

_HORSE = "PLT-HORSE-001"
_TRAILER_A = "PLT-TRAILER-001"
_TRAILER_B = "PLT-TRAILER-002"

# ---------------------------------------------------------------------------
# Hand-built payloads in the ASSUMED response shape. Not recorded. See docstring.
# ---------------------------------------------------------------------------

_ONE_POSITION = json.dumps(
    {
        "positions": [
            {
                "device_id": _HORSE,
                "latitude": -33.9248765,
                "longitude": 18.4241234,
                "timestamp": "2026-09-04T08:12:03+00:00",
            }
        ]
    }
)

_NO_FIX_POSITION = json.dumps(
    {
        "positions": [
            {
                "device_id": _HORSE,
                "latitude": None,
                "longitude": None,
                "timestamp": "2026-09-04T08:12:03+00:00",
            }
        ]
    }
)

_THREE_POSITIONS = json.dumps(
    {
        "positions": [
            # Deliberately out of requested order: the client must answer by device
            # id, not by the order Pulsit happens to list them in.
            {
                "device_id": _TRAILER_B,
                "latitude": -33.9250,
                "longitude": 18.4242,
                "timestamp": "2026-09-04T08:12:05+00:00",
            },
            {
                "device_id": _HORSE,
                "latitude": -33.9249,
                "longitude": 18.4241,
                "timestamp": "2026-09-04T08:12:03+00:00",
            },
            {
                "device_id": _TRAILER_A,
                "latitude": -33.9251,
                "longitude": 18.4243,
                "timestamp": "2026-09-04T08:12:04+00:00",
            },
        ]
    }
)


@pytest.fixture
def pulsit_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the client at a test URL with a test credential, never at .env."""
    monkeypatch.setattr(settings, "PULSE_API_URL", _PULSIT_BASE)
    monkeypatch.setattr(settings, "PULSE_API_KEY", "test-bearer-key")
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", False)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_normal_fix_is_parsed(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_ONE_POSITION)
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.status is PulsitFixStatus.OK
    assert fix.has_position is True
    assert fix.device_id == _HORSE


@pytest.mark.asyncio
@respx.mock
async def test_coordinates_keep_full_decimal_precision(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_ONE_POSITION)
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    # Parsed via str(), so the decimal value sent survives rather than the binary
    # float approximation json.loads produced.
    assert fix.lat == Decimal("-33.9248765")
    assert fix.lng == Decimal("18.4241234")


@pytest.mark.asyncio
@respx.mock
async def test_live_fix_is_labelled_as_live_sourced(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_ONE_POSITION)
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.source is PulsitFixSource.LIVE


@pytest.mark.asyncio
@respx.mock
async def test_fix_timestamp_is_the_trackers_not_ours(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_ONE_POSITION)
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.fixed_at is not None
    assert fix.fixed_at.isoformat() == "2026-09-04T08:12:03+00:00"


@pytest.mark.asyncio
@respx.mock
async def test_bearer_credential_is_sent(pulsit_settings):
    route = respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_ONE_POSITION)
    )

    await LivePulsitClient().get_position(_HORSE)

    assert route.calls.last.request.headers["Authorization"] == "Bearer test-bearer-key"


# ---------------------------------------------------------------------------
# A trailer set — several units in one call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_multiple_units_are_answered_in_requested_order(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_THREE_POSITIONS)
    )

    fixes = await LivePulsitClient().get_positions([_HORSE, _TRAILER_A, _TRAILER_B])

    assert [f.device_id for f in fixes] == [_HORSE, _TRAILER_A, _TRAILER_B]
    assert [f.lat for f in fixes] == [
        Decimal("-33.9249"),
        Decimal("-33.9251"),
        Decimal("-33.925"),
    ]


@pytest.mark.asyncio
@respx.mock
async def test_multiple_units_cost_a_single_request(pulsit_settings):
    """FP-195 writes a snapshot per trailer; a round trip per trailer is the bug."""
    route = respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_THREE_POSITIONS)
    )

    await LivePulsitClient().get_positions([_HORSE, _TRAILER_A, _TRAILER_B])

    assert route.call_count == 1
    assert route.calls.last.request.url.params["device_ids"] == (
        f"{_HORSE},{_TRAILER_A},{_TRAILER_B}"
    )


@pytest.mark.asyncio
async def test_empty_request_makes_no_call(pulsit_settings):
    # No respx route registered: any outbound request would fail the test.
    assert await LivePulsitClient().get_positions([]) == []


# ---------------------------------------------------------------------------
# Absences — none of these may raise
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_null_coordinates_read_as_no_fix(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=_NO_FIX_POSITION)
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.status is PulsitFixStatus.NO_FIX
    assert fix.lat is None and fix.lng is None


@pytest.mark.asyncio
@respx.mock
async def test_device_absent_from_response_reads_as_unknown_device(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=json.dumps({"positions": []}))
    )

    fix = await LivePulsitClient().get_position("PLT-NOT-A-REAL-TRACKER")

    assert fix.status is PulsitFixStatus.UNKNOWN_DEVICE
    assert fix.device_id == "PLT-NOT-A-REAL-TRACKER"


@pytest.mark.asyncio
@respx.mock
async def test_timeout_reads_as_unavailable_for_every_device(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        side_effect=httpx.TimeoutException("timed out")
    )

    fixes = await LivePulsitClient().get_positions([_HORSE, _TRAILER_A])

    # A slow tracker API must not hold a driver at a gate, and it must not claim
    # the vehicle was missing either.
    assert [f.status for f in fixes] == [PulsitFixStatus.UNAVAILABLE] * 2
    assert [f.device_id for f in fixes] == [_HORSE, _TRAILER_A]


@pytest.mark.asyncio
@respx.mock
async def test_http_error_reads_as_unavailable(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(return_value=httpx.Response(503))

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.status is PulsitFixStatus.UNAVAILABLE


@pytest.mark.asyncio
@respx.mock
async def test_transport_failure_reads_as_unavailable(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.status is PulsitFixStatus.UNAVAILABLE


@pytest.mark.asyncio
async def test_missing_api_url_reads_as_unavailable_without_calling_out(pulsit_settings, monkeypatch):
    monkeypatch.setattr(settings, "PULSE_API_URL", "")

    # No respx route registered: any outbound request would fail the test.
    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.status is PulsitFixStatus.UNAVAILABLE


# ---------------------------------------------------------------------------
# Malformed responses
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_body_that_is_not_json_reads_as_unavailable(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text="<html>gateway error</html>")
    )

    fix = await LivePulsitClient().get_position(_HORSE)

    assert fix.status is PulsitFixStatus.UNAVAILABLE


@pytest.mark.asyncio
@respx.mock
async def test_missing_positions_list_reads_as_unavailable_for_all(pulsit_settings):
    respx.get(url__startswith=_PULSIT_BASE).mock(
        return_value=httpx.Response(200, text=json.dumps({"unexpected": "envelope"}))
    )

    fixes = await LivePulsitClient().get_positions([_HORSE, _TRAILER_A])

    # The envelope itself is unreadable, so nothing in it can be trusted — and that
    # is not a claim about either vehicle.
    assert [f.status for f in fixes] == [PulsitFixStatus.UNAVAILABLE] * 2


@pytest.mark.asyncio
@respx.mock
async def test_one_malformed_entry_does_not_discard_the_others(pulsit_settings):
    payload = json.dumps(
        {
            "positions": [
                {
                    "device_id": _HORSE,
                    "latitude": "not-a-coordinate",
                    "longitude": 18.4241,
                    "timestamp": "2026-09-04T08:12:03+00:00",
                },
                {
                    "device_id": _TRAILER_A,
                    "latitude": -33.9251,
                    "longitude": 18.4243,
                    "timestamp": "2026-09-04T08:12:04+00:00",
                },
            ]
        }
    )
    respx.get(url__startswith=_PULSIT_BASE).mock(return_value=httpx.Response(200, text=payload))

    fixes = await LivePulsitClient().get_positions([_HORSE, _TRAILER_A])

    # One bad trailer must not cost the evidence for the rest of the set.
    assert fixes[0].status is PulsitFixStatus.UNAVAILABLE
    assert fixes[1].status is PulsitFixStatus.OK


@pytest.mark.asyncio
@respx.mock
async def test_entry_missing_its_timestamp_reads_as_unavailable(pulsit_settings):
    payload = json.dumps(
        {"positions": [{"device_id": _HORSE, "latitude": -33.9249, "longitude": 18.4241}]}
    )
    respx.get(url__startswith=_PULSIT_BASE).mock(return_value=httpx.Response(200, text=payload))

    fix = await LivePulsitClient().get_position(_HORSE)

    # A position with no time is not evidence of anything — it cannot be placed
    # against a phase moment.
    assert fix.status is PulsitFixStatus.UNAVAILABLE


# ---------------------------------------------------------------------------
# The mock/live switch
# ---------------------------------------------------------------------------


def test_factory_returns_mock_when_mock_mode_is_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", True)

    assert isinstance(get_pulsit_client(), MockPulsitClient)


def test_factory_returns_live_client_when_mock_mode_is_off(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "PULSE_USE_MOCK", False)

    assert isinstance(get_pulsit_client(), LivePulsitClient)
