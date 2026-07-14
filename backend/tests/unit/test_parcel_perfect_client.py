"""Unit tests: Parcel Perfect ecomService v28 API client.

respx mocks httpx at the transport layer so no real network calls are made.
The module-level _cached_token is reset before each test to ensure auth
flow isolation between test runs.
"""

import json

import httpx
import pytest
import respx

import app.integrations.parcel_perfect as pp_module
from app.integrations.parcel_perfect import (
    MOCK_WAYBILL_RESPONSE,
    MockParcelPerfectClient,
    ParcelPerfectClient,
    get_pp_client,
)

# ---------------------------------------------------------------------------
# Shared test constants
# ---------------------------------------------------------------------------

_PP_BASE = "http://pp.test/api"

# Canonical getSingleWaybill payload matching the v28 spec shape used in tests.
# Includes the full field set added in the extended dataclasses (poddate, service, etc.)
_WAYBILL_PAYLOAD = {
    "errorcode": 0,
    "errormessage": "",
    "results": [
        {
            "details": {
                "waybill": "TESTWAY001",
                "waydate": "11.01.2024",
                "declaredvalue": 5800.00,
                "pieces": 3,
                "destperadd1": "11 Lansdowne Rd",
                "desttown": "CLAREMONT (Cape Town)",
                "destpers": "Test Receiver",
                "destpertel": "0210000001",
                "duedate": "13.01.2024",
                "origpers": "Test Shipper",
                "origtown": "JOHANNESBURG",
                "origperadd1": "1 Test St",
                "service": "ONX",
                "actkg": 7.5,
                "total": 210.00,
                "poddate": "",
                "failtype": None,
                "reference": "CLIENTREF001",
            },
            "contents": [
                {"item": 1, "description": "Electronics", "actmass": 2.5, "pieces": 2}
            ],
            "tracks": [
                {"trackno": "TESTWAY0010001", "parcelno": 1, "item": 1},
                {"trackno": "TESTWAY0010002", "parcelno": 2, "item": 1},
            ],
            "wayrefs": [
                {"reference": "CLIENTREF001", "pageno": 1},
            ],
        }
    ],
}

# Reusable pre-serialised auth responses (avoids repeated json.dumps in each test).
_MOCK_SALT_RESP = json.dumps({
    "errorcode": 0,
    "errormessage": "",
    "results": [{"salt": "testsalt"}],
})

_MOCK_TOKEN_RESP = json.dumps({
    "errorcode": 0,
    "errormessage": "",
    "results": [{"token_id": "tok-abc123"}],
})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_cached_token():
    """Reset the module-level token cache before every test.

    The cache is intentionally module-global (process lifetime) in production,
    but tests must be isolated — a cached token from one test must not bleed
    into auth-flow assertions in the next.
    """
    pp_module._cached_token = None
    yield
    pp_module._cached_token = None


@pytest.fixture
def pp_settings(monkeypatch):
    """Patch settings so PP calls use a known test URL without reading .env.

    PP_API_TOKEN is cleared so the full salt/MD5 auth flow is exercised by
    tests that mock getSalt and getSecureToken responses. Without this, a
    real token in .env would skip auth and misalign the mock response queue.
    """
    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_API_URL", _PP_BASE)
    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_API_KEY", "user@test.com")
    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_API_PASSWORD", "testpassword")
    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_API_TOKEN", "")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_get_single_waybill_happy_path(pp_settings):
    """getSingleWaybill performs auth (getSalt + getSecureToken) then returns
    a fully-parsed PPWaybillResponse matching the v28 spec fixture."""
    # Three sequential GET calls in order: getSalt, getSecureToken, getSingleWaybill.
    respx.get(url__startswith=_PP_BASE).mock(
        side_effect=[
            httpx.Response(200, text=_MOCK_SALT_RESP),
            httpx.Response(200, text=_MOCK_TOKEN_RESP),
            httpx.Response(200, text=json.dumps(_WAYBILL_PAYLOAD)),
        ]
    )

    client = ParcelPerfectClient()
    result = await client.get_single_waybill("TESTWAY001")

    assert result.details.waybill == "TESTWAY001"
    assert result.details.pieces == 3
    assert result.details.declared_value == 5800.0
    assert result.details.service == "ONX"
    assert result.details.actual_weight_kg == 7.5
    assert result.details.freight_total == 210.00
    assert result.details.poddate == ""
    assert result.details.failtype is None
    assert result.details.orig_person == "Test Shipper"
    assert result.details.orig_town == "JOHANNESBURG"
    assert result.details.client_reference == "CLIENTREF001"
    assert result.is_delivered is False
    assert len(result.tracks) == 2
    assert result.tracks[0].trackno == "TESTWAY0010001"
    assert result.tracks[1].trackno == "TESTWAY0010002"
    assert len(result.contents) == 1
    assert result.contents[0].description == "Electronics"
    assert len(result.wayrefs) == 1
    assert result.wayrefs[0].reference == "CLIENTREF001"


@pytest.mark.asyncio
@respx.mock
async def test_token_cached_on_second_call(pp_settings):
    """A second call reuses the cached token without repeating getSalt/getSecureToken.

    Four responses are queued: getSalt, getSecureToken, waybill1, waybill2.
    If auth were re-run on the second call we would need 6 responses and respx
    would raise a StopIteration (or an AllMocked error), failing the test.
    """
    respx.get(url__startswith=_PP_BASE).mock(
        side_effect=[
            httpx.Response(200, text=_MOCK_SALT_RESP),
            httpx.Response(200, text=_MOCK_TOKEN_RESP),
            httpx.Response(200, text=json.dumps(_WAYBILL_PAYLOAD)),
            httpx.Response(200, text=json.dumps(_WAYBILL_PAYLOAD)),
        ]
    )

    client = ParcelPerfectClient()
    await client.get_single_waybill("TESTWAY001")
    await client.get_single_waybill("TESTWAY001")

    # Token must be cached at module level after the first call.
    assert pp_module._cached_token == "tok-abc123"


@pytest.mark.asyncio
@respx.mock
async def test_pp_error_response_raises_value_error(pp_settings):
    """Non-zero errorcode raises ValueError with the PP message — no retry for domain errors.

    "Waybill not found" contains no auth keyword, so the narrow retry guard passes
    it straight through without re-auth. Only 3 responses needed.
    """
    error_payload = json.dumps({
        "errorcode": 404,
        "errormessage": "Waybill not found",
        "results": [],
    })
    respx.get(url__startswith=_PP_BASE).mock(
        side_effect=[
            httpx.Response(200, text=_MOCK_SALT_RESP),
            httpx.Response(200, text=_MOCK_TOKEN_RESP),
            httpx.Response(200, text=error_payload),
        ]
    )

    client = ParcelPerfectClient()
    with pytest.raises(ValueError, match="Waybill not found"):
        await client.get_single_waybill("BADWAY999")


@pytest.mark.asyncio
async def test_mock_client_returns_fixture():
    """MockParcelPerfectClient.get_single_waybill returns MOCK_WAYBILL_RESPONSE
    regardless of the waybill number, without any HTTP call."""
    client = MockParcelPerfectClient()
    result = await client.get_single_waybill("anything")

    # Verify against the module-level constant so the test stays in sync if the
    # fixture changes.
    assert result is MOCK_WAYBILL_RESPONSE
    assert result.details.waybill == "MOCKWAY001"
    assert len(result.tracks) == 2


def test_get_pp_client_mock_mode(monkeypatch):
    """get_pp_client() returns MockParcelPerfectClient when PP_USE_MOCK=True.

    Plain def — get_pp_client() is synchronous; no coroutine needed.
    """
    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_USE_MOCK", True)
    client = get_pp_client()
    assert isinstance(client, MockParcelPerfectClient)


def test_get_pp_client_real_mode(monkeypatch):
    """get_pp_client() returns ParcelPerfectClient when PP_USE_MOCK=False.

    Plain def — get_pp_client() is synchronous; no coroutine needed.
    """
    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_USE_MOCK", False)
    client = get_pp_client()
    assert isinstance(client, ParcelPerfectClient)


@pytest.mark.asyncio
@respx.mock
async def test_get_single_waybill_empty_results_raises(pp_settings):
    """PP returning errorcode=0 with an empty results list must raise ValueError."""
    empty_resp = json.dumps({"errorcode": 0, "errormessage": "", "results": []})
    respx.get(url__startswith=_PP_BASE).mock(
        side_effect=[
            httpx.Response(200, text=_MOCK_SALT_RESP),
            httpx.Response(200, text=_MOCK_TOKEN_RESP),
            httpx.Response(200, text=empty_resp),
        ]
    )
    client = ParcelPerfectClient()
    with pytest.raises(ValueError, match="empty results"):
        await client.get_single_waybill("WAY_EMPTY")


@pytest.mark.asyncio
@respx.mock
async def test_get_single_waybill_http_error_raises(pp_settings):
    """A non-2xx HTTP response from PP must propagate as httpx.HTTPStatusError."""
    respx.get(url__startswith=_PP_BASE).mock(
        side_effect=[
            httpx.Response(200, text=_MOCK_SALT_RESP),
            httpx.Response(200, text=_MOCK_TOKEN_RESP),
            httpx.Response(500, text="Internal Server Error"),
        ]
    )
    client = ParcelPerfectClient()
    with pytest.raises(httpx.HTTPStatusError):
        await client.get_single_waybill("WAY001")
