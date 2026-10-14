"""Draw a trip's route as a self-contained SVG for the audit-pack PDF.

No map tiles, on purpose: fetching tiles would send the trip's coordinates to a
third-party tile server (POPIA), make the PDF depend on someone else's uptime, and make
two renders of the same manifest differ. The drawing is deterministic — same manifest,
byte-identical SVG — which an evidence document needs.

Projection is equirectangular around the route's mean latitude: at freight-corridor
scale (hundreds of km) the distortion is far below what a printed page can show.
"""

import math
from collections.abc import Sequence
from datetime import datetime
from html import escape

from app.schemas.audit_pack import AuditPackManifest, CoverageGap, PositionFix

# Metres per degree of latitude — close enough everywhere for a drawing (±0.5%).
METRES_PER_DEGREE = 111_320.0

# Space kept clear round the edge so markers and labels are never clipped.
PADDING_PX = 36.0

# A single precinct would otherwise fill the page at street scale; frame at least this
# much ground so a one-stop trip still reads as a map.
MIN_EXTENT_METRES = 2_000.0

# Scale bar aims for roughly this length before rounding to a 1-2-5 distance.
SCALE_BAR_TARGET_PX = 120.0

STOP_MIN_RADIUS_PX = 5.0
CHECKPOINT_RADIUS_PX = 4.0
TRACKER_SIZE_PX = 6.0
EXCEPTION_SIZE_PX = 7.0

_TRACKER_SOURCES = frozenset({"vehicle_tracker", "trailer_tracker"})


class _Frame:
    """Maps lat/lng to canvas pixels, north up, preserving aspect ratio."""

    def __init__(self, points: Sequence[tuple[float, float]], width: float, height: float) -> None:
        self.height = height
        mean_lat = sum(lat for lat, _ in points) / len(points)
        self._x_factor = math.cos(math.radians(mean_lat)) * METRES_PER_DEGREE
        xs = [lng * self._x_factor for _, lng in points]
        ys = [lat * METRES_PER_DEGREE for lat, _ in points]
        span_x = max(max(xs) - min(xs), MIN_EXTENT_METRES)
        span_y = max(max(ys) - min(ys), MIN_EXTENT_METRES)
        self.scale = min((width - 2 * PADDING_PX) / span_x, (height - 2 * PADDING_PX) / span_y)
        # Centre the route inside the padded box on both axes.
        self._origin_x = (min(xs) + max(xs)) / 2 - (width / 2) / self.scale
        self._origin_y = (min(ys) + max(ys)) / 2 - (height / 2) / self.scale

    def px(self, lat: float, lng: float) -> tuple[float, float]:
        x = (lng * self._x_factor - self._origin_x) * self.scale
        y = self.height - (lat * METRES_PER_DEGREE - self._origin_y) * self.scale
        return round(x, 1), round(y, 1)


def _scale_bar_metres(metres_per_px: float) -> float:
    target = SCALE_BAR_TARGET_PX * metres_per_px
    magnitude = 10 ** math.floor(math.log10(target))
    return max(step * magnitude for step in (1, 2, 5) if step * magnitude <= target)


def _distance_label(metres: float) -> str:
    return f"{metres / 1000:g} km" if metres >= 1000 else f"{metres:g} m"


def _spans_gap(start: datetime, end: datetime, gaps: Sequence[CoverageGap]) -> bool:
    return any(gap.start < end and gap.end > start for gap in gaps)


def _placeholder(width: int, height: int) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">'
        f'<rect width="{width}" height="{height}" fill="#f4f4f2"/>'
        f'<text x="{width / 2}" y="{height / 2}" text-anchor="middle" font-size="14" fill="#555">'
        "No position data recorded for this trip.</text></svg>"
    )


def _trail_elements(frame: _Frame, trail: Sequence[PositionFix], gaps: Sequence[CoverageGap]) -> list[str]:
    """Phone fixes joined in time order; a segment spanning a coverage gap is dashed,
    because a straight line there would imply a route nobody recorded."""
    timed = sorted(
        ((f.recorded_at, f) for f in trail if f.source == "driver_phone" and f.recorded_at is not None),
        key=lambda pair: pair[0],
    )
    elements: list[str] = []
    run: list[tuple[float, float]] = []

    def flush() -> None:
        if len(run) >= 2:
            points = " ".join(f"{x},{y}" for x, y in run)
            elements.append(f'<polyline class="trail" points="{points}" fill="none" stroke="#1f5fa8" stroke-width="2"/>')

    for (previous_at, previous), (at, fix) in zip(timed, timed[1:]):
        start, end = frame.px(previous.lat, previous.lng), frame.px(fix.lat, fix.lng)
        if _spans_gap(previous_at, at, gaps):
            flush()
            run = []
            elements.append(
                f'<line class="gap" x1="{start[0]}" y1="{start[1]}" x2="{end[0]}" y2="{end[1]}" '
                'stroke="#b0b0b0" stroke-width="2" stroke-dasharray="6 4"/>'
            )
            continue
        if not run:
            run.append(start)
        run.append(end)
    flush()
    return elements


def render_route_svg(manifest: AuditPackManifest, *, width: int = 800, height: int = 480) -> str:
    stops = manifest.stops
    trail = manifest.location_trail
    exception_fixes = [(i, e.position) for i, e in enumerate(manifest.exceptions, start=1) if e.position]
    checkpoint_fixes = [c.driver_phone for c in manifest.checkpoints if c.driver_phone is not None]

    points = [
        *((s.lat, s.lng) for s in stops),
        *((f.lat, f.lng) for f in trail),
        *((f.lat, f.lng) for _, f in exception_fixes),
        *((f.lat, f.lng) for f in checkpoint_fixes),
    ]
    if not points:
        return _placeholder(width, height)

    frame = _Frame(points, width, height)
    body: list[str] = [f'<rect width="{width}" height="{height}" fill="#f7f7f5"/>']

    for stop in stops:
        x, y = frame.px(stop.lat, stop.lng)
        radius = round(max(STOP_MIN_RADIUS_PX, stop.geofence_radius_metres * frame.scale), 1)
        name = escape(stop.precinct_name, quote=True)
        body.append(
            f'<circle class="stop" cx="{x}" cy="{y}" r="{radius}" data-name="{name}" '
            'fill="#2e7d4f" fill-opacity="0.25" stroke="#2e7d4f" stroke-width="1.5"/>'
        )
        body.append(
            f'<text class="stop-label" x="{x + radius + 4}" y="{y + 4}" font-size="11" fill="#1d4d31">'
            f"{stop.sequence}. {name}</text>"
        )

    body.extend(_trail_elements(frame, trail, manifest.location_coverage.gaps))

    half = TRACKER_SIZE_PX / 2
    for fix in trail:
        if fix.source in _TRACKER_SOURCES:
            x, y = frame.px(fix.lat, fix.lng)
            body.append(
                f'<rect class="tracker" x="{round(x - half, 1)}" y="{round(y - half, 1)}" '
                f'width="{TRACKER_SIZE_PX}" height="{TRACKER_SIZE_PX}" fill="#7a4fb5"/>'
            )

    for fix in checkpoint_fixes:
        x, y = frame.px(fix.lat, fix.lng)
        body.append(f'<circle class="checkpoint" cx="{x}" cy="{y}" r="{CHECKPOINT_RADIUS_PX}" fill="#1f5fa8"/>')

    size = EXCEPTION_SIZE_PX
    for number, fix in exception_fixes:
        x, y = frame.px(fix.lat, fix.lng)
        body.append(
            f'<path class="exception" d="M{x} {round(y - size, 1)} L{round(x + size, 1)} {y} '
            f'L{x} {round(y + size, 1)} L{round(x - size, 1)} {y} Z" fill="#c62828"/>'
        )
        body.append(
            f'<text class="exception-label" x="{round(x + size + 3, 1)}" y="{round(y - size, 1)}" '
            f'font-size="11" font-weight="bold" fill="#c62828">E{number}</text>'
        )

    bar_metres = _scale_bar_metres(1 / frame.scale)
    bar_px = round(bar_metres * frame.scale, 1)
    bar_y = height - 14
    body.append(
        f'<line class="scale" x1="14" y1="{bar_y}" x2="{14 + bar_px}" y2="{bar_y}" stroke="#333" stroke-width="2"/>'
        f'<text x="14" y="{bar_y - 5}" font-size="10" fill="#333">{_distance_label(bar_metres)}</text>'
        f'<text x="{width - 20}" y="24" font-size="14" font-weight="bold" fill="#333" text-anchor="middle">N</text>'
        f'<path d="M{width - 20} 28 L{width - 25} 40 L{width - 15} 40 Z" fill="#333"/>'
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        'font-family="DejaVu Sans, Arial, sans-serif">' + "".join(body) + "</svg>"
    )
