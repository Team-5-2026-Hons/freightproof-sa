"""Unit tests for reporting/route_svg.py — the server-drawn route in the audit-pack PDF."""

import re
import uuid
from datetime import timedelta

from app.orchestration.audit_pack_analysis import COVERAGE_GAP_THRESHOLD
from app.reporting.route_svg import render_route_svg
from app.schemas.audit_pack import CoverageGap, PositionFix, StopRecord

from tests.unit.audit_pack_factories import T0, make_exception, make_manifest

JHB = (-26.2041, 28.0473)
HARRISMITH = (-28.2726, 29.1294)
DBN = (-29.8587, 31.0218)


def _stop(seq: int, lat_lng: tuple[float, float], name: str) -> StopRecord:
    return StopRecord(
        trip_stop_id=uuid.uuid4(), sequence=seq, precinct_id=uuid.uuid4(), precinct_name=name,
        address=None, lat=lat_lng[0], lng=lat_lng[1], geofence_radius_metres=300, slot_time=None,
    )


def _phone(lat_lng: tuple[float, float], minutes: int) -> PositionFix:
    return PositionFix(lat=lat_lng[0], lng=lat_lng[1], source="driver_phone",
                       recorded_at=T0 + timedelta(minutes=minutes))


def _points(svg: str) -> list[tuple[float, float]]:
    return [(float(x), float(y)) for x, y in re.findall(r'cx="([\d.]+)" cy="([\d.]+)"', svg)]


def test_render_route_svg_without_positions_says_so():
    # Act
    svg = render_route_svg(make_manifest(phases=[]))

    # Assert
    assert svg.startswith("<svg")
    assert "No position data" in svg


def test_render_route_svg_draws_each_stop_with_its_name():
    # Arrange
    manifest = make_manifest(phases=[], stops=[_stop(1, JHB, "FedEx JHB"), _stop(2, DBN, "FedEx DBN")])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    assert svg.count('class="stop"') == 2
    assert "FedEx JHB" in svg
    assert "FedEx DBN" in svg


def test_render_route_svg_keeps_every_point_inside_the_canvas():
    # Arrange
    manifest = make_manifest(
        phases=[], stops=[_stop(1, JHB, "A"), _stop(2, DBN, "B")],
        trail=[_phone(JHB, 0), _phone(HARRISMITH, 20), _phone(DBN, 40)],
    )

    # Act
    svg = render_route_svg(manifest, width=800, height=480)

    # Assert
    points = _points(svg)
    assert points
    assert all(0 <= x <= 800 and 0 <= y <= 480 for x, y in points)


def test_render_route_svg_puts_north_at_the_top():
    # Arrange: Johannesburg is north of Durban, so it must be drawn higher (smaller y).
    manifest = make_manifest(phases=[], stops=[_stop(1, JHB, "North"), _stop(2, DBN, "South")])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    north_y = float(re.search(r'class="stop"[^>]*cy="([\d.]+)"[^>]*data-name="North"', svg).group(1))
    south_y = float(re.search(r'class="stop"[^>]*cy="([\d.]+)"[^>]*data-name="South"', svg).group(1))
    assert north_y < south_y


def test_render_route_svg_draws_gap_as_dashed_segment():
    # Arrange: the manifest's own coverage gap spans the segment between two fixes —
    # the drawing reuses it rather than re-deriving gaps with a threshold of its own.
    later = int((COVERAGE_GAP_THRESHOLD + timedelta(minutes=10)).total_seconds() // 60)
    gap = CoverageGap(start=T0, end=T0 + timedelta(minutes=later), minutes=later)
    manifest = make_manifest(phases=[], trail=[_phone(JHB, 0), _phone(HARRISMITH, later)], gaps=[gap])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    assert 'class="gap"' in svg
    assert "stroke-dasharray" in svg


def test_render_route_svg_continuous_trail_has_no_gap_segment():
    # Arrange
    manifest = make_manifest(phases=[], trail=[_phone(JHB, 0), _phone(HARRISMITH, 10), _phone(DBN, 20)])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    assert 'class="gap"' not in svg
    assert 'class="trail"' in svg


def test_render_route_svg_numbers_exception_markers():
    # Arrange
    panic = make_exception(
        "panic_button", "critical",
        position=PositionFix(lat=HARRISMITH[0], lng=HARRISMITH[1], source="driver_phone", recorded_at=T0),
    )
    manifest = make_manifest(phases=[], exceptions=[panic], stops=[_stop(1, JHB, "A")])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    assert svg.count('class="exception"') == 1
    assert ">E1<" in svg


def test_render_route_svg_includes_a_scale_bar_in_km():
    # Arrange
    manifest = make_manifest(phases=[], stops=[_stop(1, JHB, "A"), _stop(2, DBN, "B")])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    assert re.search(r">\d+ km<", svg)


def test_render_route_svg_is_deterministic():
    # Arrange
    manifest = make_manifest(
        phases=[], stops=[_stop(1, JHB, "A")], trail=[_phone(JHB, 0), _phone(DBN, 90)],
    )

    # Act / Assert
    assert render_route_svg(manifest) == render_route_svg(manifest)


def test_render_route_svg_escapes_stop_names():
    # Arrange
    manifest = make_manifest(phases=[], stops=[_stop(1, JHB, "<script>&")])

    # Act
    svg = render_route_svg(manifest)

    # Assert
    assert "<script>" not in svg
    assert "&lt;script&gt;&amp;" in svg
