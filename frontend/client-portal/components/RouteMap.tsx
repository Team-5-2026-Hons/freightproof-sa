'use client'

// Leaflet driven imperatively (no react-leaflet): one map instance for the page's life,
// layers built once from the frozen manifest, selection applied by panning. Loaded with
// ssr:false by PackViewer — Leaflet touches `window` at import time.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatSast } from '@/lib/format'
import { mediaMatches, prefersReducedMotion } from '@/lib/media'
import { OSM_TILES } from '@/lib/tiles'
import { instantMs, compareInstants, type TimelineItem } from '@/lib/timeline'
import type { AuditPackManifest, CoverageGap, PositionFix, StopRecord } from '@/lib/types'

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL || OSM_TILES
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

const COLOUR = { trail: '#0051d5', gap: '#777680', tracker: '#7a4fb5', checkpoint: '#0051d5', exception: '#ba1a1a', stop: '#006c4c' }
const MAX_ZOOM = 18
const FOCUS_ZOOM = 13
const FALLBACK_CENTRE: L.LatLngTuple = [-28.5, 26.5]
const FALLBACK_ZOOM = 5
const FLY_DURATION_SECONDS = 0.6
const FIT_PADDING: L.PointTuple = [24, 24]
const NARROW_SCREEN_QUERY = '(max-width: 640px)'
const MARKER_RADIUS = { tracker: 4, checkpoint: 6, exception: 8, selectedPhase: 7 }
const MARKER_STYLE = { normal: { weight: 3, fillOpacity: 0.9 }, selected: { weight: 6, fillOpacity: 1 } }
const MIN_POLYGON_POINTS = 3

interface Props {
  manifest: AuditPackManifest
  items: TimelineItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * Tooltip content as a DOM node whose text is set with `textContent`.
 *
 * Leaflet's `bindTooltip(string)` assigns the string to `innerHTML` (DivOverlay._updateContent),
 * and precinct names and event titles are typed by operators: a name like `<img src=x onerror=…>`
 * would run script inside an insurer's browser. A node is appended as-is, so the text stays text.
 */
export function textTooltip(text: string): HTMLElement {
  const node = document.createElement('span')
  node.textContent = text
  return node
}

function spansGap(a: string, b: string, gaps: CoverageGap[]): boolean {
  const from = instantMs(a)
  const to = instantMs(b)
  return gaps.some((gap) => instantMs(gap.start) < to && instantMs(gap.end) > from)
}

function trailLayers(trail: PositionFix[], gaps: CoverageGap[]): L.LayerGroup {
  const phone = trail
    .filter((f): f is PositionFix & { recorded_at: string } => f.source === 'driver_phone' && f.recorded_at !== null)
    .sort((a, b) => compareInstants(a.recorded_at, b.recorded_at))
  const group = L.layerGroup()
  const draw = (run: L.LatLngTuple[]) => {
    if (run.length > 1) L.polyline(run, { color: COLOUR.trail, weight: 3 }).addTo(group)
  }
  let run: L.LatLngTuple[] = phone.length > 0 ? [[phone[0].lat, phone[0].lng]] : []
  for (let i = 1; i < phone.length; i++) {
    const previous = phone[i - 1]
    const fix = phone[i]
    if (spansGap(previous.recorded_at, fix.recorded_at, gaps)) {
      draw(run)
      L.polyline([[previous.lat, previous.lng], [fix.lat, fix.lng]], { color: COLOUR.gap, weight: 2, dashArray: '6 6' })
        .bindTooltip(textTooltip('No position recorded for this stretch'))
        .addTo(group)
      run = [[fix.lat, fix.lng]]
    } else {
      run.push([fix.lat, fix.lng])
    }
  }
  draw(run)
  return group
}

/** The outline when the stop was fenced by one, else the radius circle. A malformed outline falls back to the circle. */
function geofenceLayer(stop: StopRecord): L.Path {
  const style = { color: COLOUR.stop, weight: 2, fillOpacity: 0.15 }
  const outline = (stop.geofence_polygon ?? []).filter(
    (corner): corner is [number, number] => Array.isArray(corner) && Number.isFinite(corner[0]) && Number.isFinite(corner[1]),
  )
  if (outline.length >= MIN_POLYGON_POINTS) return L.polygon(outline, style)
  return L.circle([stop.lat, stop.lng], { ...style, radius: stop.geofence_radius_metres })
}

function mapPoints(manifest: AuditPackManifest, items: TimelineItem[]): L.LatLngTuple[] {
  return [
    ...manifest.stops.map((s): L.LatLngTuple => [s.lat, s.lng]),
    ...manifest.location_trail.map((f): L.LatLngTuple => [f.lat, f.lng]),
    ...items.flatMap((i) => i.positions.map((p): L.LatLngTuple => [p.lat, p.lng])),
  ]
}

export default function RouteMap({ manifest, items, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const highlighted = useRef<L.CircleMarker | null>(null)
  const temporary = useRef<L.CircleMarker | null>(null)
  const [narrow] = useState(() => mediaMatches(NARROW_SCREEN_QUERY))
  const [panEnabled, setPanEnabled] = useState(!narrow)
  const hasPositions = useMemo(() => mapPoints(manifest, items).length > 0, [manifest, items])

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = L.map(container.current, { scrollWheelZoom: false, preferCanvas: true, dragging: !narrow })
    map.current = instance
    const markerIndex = markers.current
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: MAX_ZOOM, referrerPolicy: 'strict-origin' }).addTo(instance)

    const stops = L.layerGroup(manifest.stops.map((s) =>
      geofenceLayer(s).bindTooltip(textTooltip(`${s.sequence}. ${s.precinct_name}`), { permanent: !narrow, direction: 'right', className: 'text-caption' }),
    ))
    const trail = trailLayers(manifest.location_trail, manifest.location_coverage.gaps)
    const trackers = L.layerGroup(manifest.location_trail
      .filter((f) => f.source !== 'driver_phone')
      .map((f) => L.circleMarker([f.lat, f.lng], { radius: MARKER_RADIUS.tracker, color: COLOUR.tracker, fillOpacity: 1 })
        .bindTooltip(textTooltip(`${f.source === 'vehicle_tracker' ? 'Vehicle' : 'Trailer'} tracker · ${formatSast(f.recorded_at)}`))))

    const events = L.layerGroup()
    for (const item of items) {
      if (item.kind === 'phase' || item.positions.length === 0) continue
      const [first] = item.positions
      const marker = L.circleMarker([first.lat, first.lng], {
        radius: item.kind === 'exception' ? MARKER_RADIUS.exception : MARKER_RADIUS.checkpoint,
        color: item.kind === 'exception' ? COLOUR.exception : COLOUR.checkpoint,
        ...MARKER_STYLE.normal,
      }).bindTooltip(textTooltip(item.title))
      marker.on('click', () => onSelect(item.id))
      markerIndex.set(item.id, marker)
      marker.addTo(events)
    }

    const overlays: Record<string, L.LayerGroup> = {
      'Route precincts': stops, 'Driver-phone trail': trail, 'Tracker fixes': trackers, 'Checkpoints & exceptions': events,
    }
    Object.values(overlays).forEach((layer) => layer.addTo(instance))
    L.control.layers(undefined, overlays, { collapsed: narrow }).addTo(instance)
    L.control.scale({ imperial: false }).addTo(instance)

    const bounds = L.latLngBounds(mapPoints(manifest, items))
    if (bounds.isValid()) instance.fitBounds(bounds, { padding: FIT_PADDING })
    else instance.setView(FALLBACK_CENTRE, FALLBACK_ZOOM)

    return () => {
      instance.remove()
      map.current = null
      markerIndex.clear()
      highlighted.current = null
      temporary.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    if (panEnabled) instance.dragging.enable()
    else instance.dragging.disable()
  }, [panEnabled])

  useEffect(() => {
    const instance = map.current
    highlighted.current?.setStyle(MARKER_STYLE.normal)
    highlighted.current = null
    temporary.current?.remove()
    temporary.current = null

    const item = items.find((i) => i.id === selectedId)
    if (!instance || !item || item.positions.length === 0) return
    const [first] = item.positions
    const target: L.LatLngTuple = [first.lat, first.lng]
    const zoom = Math.max(instance.getZoom(), FOCUS_ZOOM)
    if (prefersReducedMotion()) instance.setView(target, zoom, { animate: false })
    else instance.flyTo(target, zoom, { duration: FLY_DURATION_SECONDS })

    let marker = markers.current.get(item.id) ?? null
    if (!marker) {
      marker = L.circleMarker(target, { radius: MARKER_RADIUS.selectedPhase, color: COLOUR.checkpoint, ...MARKER_STYLE.normal })
        .bindTooltip(textTooltip(item.title))
        .addTo(instance)
      temporary.current = marker
    }
    marker.setStyle(MARKER_STYLE.selected)
    marker.bringToFront()
    marker.openTooltip()
    highlighted.current = marker
  }, [selectedId, items])

  return (
    <div className="relative">
      <div ref={container} role="region" aria-label="Route map" className="h-[380px] w-full rounded-md sm:h-[460px]" />
      {!hasPositions && (
        <p className="pointer-events-none absolute inset-x-4 top-4 z-[1000] rounded-md bg-surf-lowest/90 px-3 py-2 text-center text-small text-muted shadow-card">
          No positions recorded in this pack
        </p>
      )}
      {narrow && (
        <button
          type="button"
          aria-pressed={panEnabled}
          onClick={() => setPanEnabled((enabled) => !enabled)}
          className="no-print absolute bottom-8 left-2 z-[1000] min-h-11 rounded-md bg-surf-lowest px-3 py-2 text-meta font-semibold shadow-card"
        >
          {panEnabled ? 'Lock map to scroll the page' : 'Unlock map to move it'}
        </button>
      )}
    </div>
  )
}
