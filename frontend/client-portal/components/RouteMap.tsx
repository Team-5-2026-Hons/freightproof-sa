'use client'

// Leaflet driven imperatively (no react-leaflet): one map instance for the page's life,
// layers built once from the frozen manifest, selection applied by panning. Loaded with
// ssr:false by PackViewer — Leaflet touches `window` at import time.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { formatSast } from '@/lib/format'
import type { TimelineItem } from '@/lib/timeline'
import type { AuditPackManifest, CoverageGap, PositionFix } from '@/lib/types'

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL || OSM_TILES
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors'

// Design-system hues (DESIGN_SYSTEM.md §2): colour carries meaning, one per source.
const COLOUR = { trail: '#0051d5', gap: '#777680', tracker: '#7a4fb5', checkpoint: '#0051d5', exception: '#ba1a1a', stop: '#006c4c' }
const FOCUS_ZOOM = 13

interface Props {
  manifest: AuditPackManifest
  items: TimelineItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function spansGap(a: string, b: string, gaps: CoverageGap[]): boolean {
  return gaps.some((gap) => gap.start < b && gap.end > a)
}

function trailLayers(trail: PositionFix[], gaps: CoverageGap[]): L.LayerGroup {
  const phone = trail
    .filter((f): f is PositionFix & { recorded_at: string } => f.source === 'driver_phone' && f.recorded_at !== null)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
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
      // A straight line across a gap would suggest a route nobody recorded.
      L.polyline([[previous.lat, previous.lng], [fix.lat, fix.lng]], { color: COLOUR.gap, weight: 2, dashArray: '6 6' })
        .bindTooltip('No position recorded for this stretch')
        .addTo(group)
      run = [[fix.lat, fix.lng]]
    } else {
      run.push([fix.lat, fix.lng])
    }
  }
  draw(run)
  return group
}

export default function RouteMap({ manifest, items, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.CircleMarker>())

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = L.map(container.current, { scrollWheelZoom: false })
    map.current = instance
    const markerIndex = markers.current
    // Origin only: tile servers need a Referer, but the path holds the share token.
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18, referrerPolicy: 'strict-origin' }).addTo(instance)

    const stops = L.layerGroup(manifest.stops.map((s) =>
      L.circle([s.lat, s.lng], { radius: s.geofence_radius_metres, color: COLOUR.stop, weight: 2, fillOpacity: 0.15 })
        .bindTooltip(`${s.sequence}. ${s.precinct_name}`, { permanent: true, direction: 'right', className: 'text-[11px]' }),
    ))
    const trail = trailLayers(manifest.location_trail, manifest.location_coverage.gaps)
    const trackers = L.layerGroup(manifest.location_trail
      .filter((f) => f.source !== 'driver_phone')
      .map((f) => L.circleMarker([f.lat, f.lng], { radius: 4, color: COLOUR.tracker, fillOpacity: 1 })
        .bindTooltip(`${f.source === 'vehicle_tracker' ? 'Vehicle' : 'Trailer'} tracker · ${formatSast(f.recorded_at)}`)))

    const events = L.layerGroup()
    for (const item of items) {
      if (item.kind === 'phase' || item.positions.length === 0) continue
      const [first] = item.positions
      const marker = L.circleMarker([first.lat, first.lng], {
        radius: item.kind === 'exception' ? 8 : 6,
        color: item.kind === 'exception' ? COLOUR.exception : COLOUR.checkpoint,
        fillOpacity: 0.9,
      }).bindTooltip(item.title)
      marker.on('click', () => onSelect(item.id))
      markerIndex.set(item.id, marker)
      marker.addTo(events)
    }

    const overlays: Record<string, L.LayerGroup> = {
      'Route precincts': stops, 'Driver-phone trail': trail, 'Tracker fixes': trackers, 'Checkpoints & exceptions': events,
    }
    Object.values(overlays).forEach((layer) => layer.addTo(instance))
    L.control.layers(undefined, overlays, { collapsed: false }).addTo(instance)
    L.control.scale({ imperial: false }).addTo(instance)

    const bounds = L.latLngBounds([
      ...manifest.stops.map((s): L.LatLngTuple => [s.lat, s.lng]),
      ...manifest.location_trail.map((f): L.LatLngTuple => [f.lat, f.lng]),
      ...items.flatMap((i) => i.positions.map((p): L.LatLngTuple => [p.lat, p.lng])),
    ])
    if (bounds.isValid()) instance.fitBounds(bounds, { padding: [24, 24] })
    else instance.setView([-28.5, 26.5], 5) // South Africa, when the pack holds no positions

    return () => {
      instance.remove()
      map.current = null
      markerIndex.clear()
    }
    // The manifest is frozen: build the layers once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const instance = map.current
    const item = items.find((i) => i.id === selectedId)
    if (!instance || !item || item.positions.length === 0) return
    const [first] = item.positions
    instance.flyTo([first.lat, first.lng], Math.max(instance.getZoom(), FOCUS_ZOOM), { duration: 0.6 })
    markers.current.get(item.id)?.openTooltip()
  }, [selectedId, items])

  return <div ref={container} role="region" aria-label="Route map" className="h-[380px] w-full rounded-md sm:h-[460px]" />
}
