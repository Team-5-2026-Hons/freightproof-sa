"""Unit tests for the OpenRouteService truck-routing client.

FIXTURE PROVENANCE: the payload shape below was observed on a live ORS call on
2026-10-14 (Johannesburg -> Harrismith area -> Durban, driving-hgv). The
coordinate list is cut down to a handful of points so the test stays readable;
segments/way_points/summary keep the live structure.

respx mocks httpx at the transport layer, so no real network call is made.
"""

from typing import Any

import httpx
import pytest
import respx

from app.core.config import settings
from app.integrations.routing import (
    RoutePoint,
    RoutingError,
    RoutingNotConfiguredError,
    compute_truck_route,
)

_ORS_BASE = "http://ors.test"
_DIRECTIONS_URL = f"{_ORS_BASE}/v2/directions/driving-hgv/geojson"

_JHB = RoutePoint(lat=-26.2041, lng=28.0473)
_MID = RoutePoint(lat=-27.9, lng=29.4)
_DBN = RoutePoint(lat=-29.7942, lng=30.982)


def _two_leg_payload() -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "segments": [
                        {"distance": 324566.9, "duration": 18016.5},
                        {"distance": 364874.3, "duration": 21494.8},
                    ],
                    "way_points": [0, 2, 4],
                    "summary": {"distance": 689441.2, "duration": 39511.3},
                },
                "geometry": {
                    "type": "LineString",
                    # [lng, lat] — the vendor's order, deliberately the reverse of ours.
                    "coordinates": [
                        [28.0473, -26.2041],
                        [28.7, -27.0],
                        [29.4, -27.9],
                        [30.2, -28.9],
                        [30.982, -29.7942],
                    ],
                },
            }
        ],
    }


@pytest.fixture(autouse=True)
def ors_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ORS_API_KEY", "test-ors-key")
    monkeypatch.setattr(settings, "ORS_API_URL", _ORS_BASE)


@respx.mock
async def test_compute_truck_route_splits_legs_at_way_points() -> None:
    respx.post(_DIRECTIONS_URL).mock(return_value=httpx.Response(200, json=_two_leg_payload()))

    route = await compute_truck_route([_JHB, _MID, _DBN])

    assert len(route.legs) == 2
    assert route.legs[0].coordinates == ((-26.2041, 28.0473), (-27.0, 28.7), (-27.9, 29.4))
    # Each leg starts where the previous one ended.
    assert route.legs[1].coordinates[0] == route.legs[0].coordinates[-1]
    assert route.legs[1].coordinates[-1] == (-29.7942, 30.982)
    assert route.legs[0].distance_metres == pytest.approx(324566.9)
    assert route.distance_metres == pytest.approx(689441.2)
    assert route.duration_seconds == pytest.approx(39511.3)


@respx.mock
async def test_compute_truck_route_sends_lng_lat_snap_radius_and_key_with_instructions_on() -> None:
    call = respx.post(_DIRECTIONS_URL).mock(return_value=httpx.Response(200, json=_two_leg_payload()))

    await compute_truck_route([_JHB, _MID, _DBN])

    request = call.calls.last.request
    body = httpx.Response(200, content=request.content).json()
    assert request.headers["Authorization"] == "test-ors-key"
    assert body["coordinates"][0] == [28.0473, -26.2041]
    assert body["radiuses"] == [settings.ORS_SNAP_RADIUS_METRES] * 3
    # Turning instructions off makes ORS drop the per-leg segments we split on.
    assert "instructions" not in body


async def test_compute_truck_route_without_key_raises_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ORS_API_KEY", "")

    with pytest.raises(RoutingNotConfiguredError):
        await compute_truck_route([_JHB, _DBN])


async def test_compute_truck_route_with_one_point_raises() -> None:
    with pytest.raises(RoutingError):
        await compute_truck_route([_JHB])


@respx.mock
async def test_compute_truck_route_unroutable_stop_raises() -> None:
    # The live 404 for a pin too far from a truck-routable road.
    respx.post(_DIRECTIONS_URL).mock(
        return_value=httpx.Response(
            404,
            json={"error": {"code": 2010, "message": "Could not find routable point within a radius of 350.0 meters"}},
        )
    )

    with pytest.raises(RoutingError, match="404"):
        await compute_truck_route([_JHB, _DBN])


@respx.mock
async def test_compute_truck_route_timeout_raises() -> None:
    respx.post(_DIRECTIONS_URL).mock(side_effect=httpx.ConnectTimeout("timed out"))

    with pytest.raises(RoutingError, match="unreachable"):
        await compute_truck_route([_JHB, _DBN])


@respx.mock
async def test_compute_truck_route_non_json_body_raises() -> None:
    respx.post(_DIRECTIONS_URL).mock(return_value=httpx.Response(200, text="<html>gateway</html>"))

    with pytest.raises(RoutingError, match="non-JSON"):
        await compute_truck_route([_JHB, _DBN])


@respx.mock
async def test_compute_truck_route_leg_count_mismatch_raises() -> None:
    # Two legs back for a two-point (one-leg) request: never trust a misaligned route.
    respx.post(_DIRECTIONS_URL).mock(return_value=httpx.Response(200, json=_two_leg_payload()))

    with pytest.raises(RoutingError, match="Expected 1 legs"):
        await compute_truck_route([_JHB, _DBN])


@respx.mock
async def test_compute_truck_route_missing_geometry_raises() -> None:
    payload = _two_leg_payload()
    del payload["features"][0]["geometry"]
    respx.post(_DIRECTIONS_URL).mock(return_value=httpx.Response(200, json=payload))

    with pytest.raises(RoutingError, match="unexpected shape"):
        await compute_truck_route([_JHB, _MID, _DBN])


@respx.mock
async def test_compute_truck_route_way_point_out_of_range_raises() -> None:
    payload = _two_leg_payload()
    payload["features"][0]["properties"]["way_points"] = [0, 2, 99]
    respx.post(_DIRECTIONS_URL).mock(return_value=httpx.Response(200, json=payload))

    with pytest.raises(RoutingError, match="outside the line"):
        await compute_truck_route([_JHB, _MID, _DBN])
