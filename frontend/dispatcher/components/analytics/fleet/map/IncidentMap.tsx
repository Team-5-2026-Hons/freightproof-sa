'use client'

import { useEffect, useRef, useState } from 'react'
import type { DivIcon, LayerGroup, Map as LeafletMap, Marker } from 'leaflet'

// A static side-effect import, exactly as GeofenceMap does it: it touches no `window`, and
// Next inlines it into this component's chunk. Leaflet's JS is loaded dynamically below.
import 'leaflet/dist/leaflet.css'

import { attachTileFailureTracking } from '@/components/map/GeofenceMap'
import { ROUTES } from '@/lib/constants/routes'
import { fmtExceptionType } from '@/lib/format/exception'
import { fmtSastDay } from '@/lib/format/period'
import { TILE_SOURCES } from '@/lib/map/tiles'
import { withReturnTo } from '@/lib/navigation/returnTo'
import type { ExceptionSeverity } from '@shared/lib/types/exception'
import type { IncidentPin } from '@shared/lib/types/fleet-analytics'
import { FLEET_COPY } from '../copy'

const COPY = FLEET_COPY.routes.incidents

/** Tall enough to read a province, short enough to keep the table twin on screen. */
export const INCIDENT_MAP_HEIGHT = 360
const PIN_SIZE_PX = 22
const FIT_PADDING_PX = 32
const SINGLE_PIN_ZOOM = 12
// Close enough to read the streets around a pin chosen from the table (D25).
const SELECTED_PIN_ZOOM = 15
// South Africa as a whole, until pins arrive.
const DEFAULT_CENTER: [number, number] = [-29, 25]
const DEFAULT_ZOOM = 5

/** Pin styling by severity, on the app's own tokens rather than hex (eslint's no-raw-hex rule,
 *  and one source of truth): warning is the light amber warn-c, critical the err red (spec
 *  §5.6, D18). Each carries a glyph, so severity never rests on colour alone. */
export const PIN_STYLE: Record<ExceptionSeverity, { className: string; glyph: string }> = {
  info: { className: 'bg-surf-high text-on-surf', glyph: 'i' },
  warning: { className: 'bg-warn-c text-warn-onc', glyph: '!' },
  critical: { className: 'bg-err text-err-on', glyph: '!!' },
}

/** A pin chosen from the table. `seq` changes on every choice, so choosing the same row again
 *  still flies back to it after the map has been moved. */
export interface PinSelection {
  id: string
  seq: number
}

/** The popup's content, built as DOM with textContent rather than an HTML string, so a report
 *  type or reference can never be read as markup. Nothing about the driver: type, severity,
 *  date, trip reference and a link to the report (spec D14). The link carries `returnTo`, so
 *  the report's Back button brings the dispatcher straight back here (D25). */
export function buildPinPopup(pin: IncidentPin, returnTo?: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'flex flex-col gap-1 text-[12px]'
  const title = document.createElement('strong')
  title.textContent = fmtExceptionType(pin.exception_type)
  const detail = document.createElement('span')
  detail.textContent = `${COPY.severities[pin.severity]} · ${fmtSastDay(pin.created_at)} · ${pin.trip_reference}`
  const open = document.createElement('a')
  open.href = withReturnTo(ROUTES.exceptionDetail(pin.exception_id), returnTo)
  open.className = 'font-[600] text-sec'
  open.textContent = COPY.open
  root.append(title, detail, open)
  return root
}

function pinIcon(L: typeof import('leaflet'), severity: ExceptionSeverity): DivIcon {
  const style = PIN_STYLE[severity]
  return L.divIcon({
    // Empty, to suppress Leaflet's default white .leaflet-div-icon box.
    className: '',
    html:
      `<div style="width:${PIN_SIZE_PX}px;height:${PIN_SIZE_PX}px" ` +
      `class="flex items-center justify-center rounded-full border-2 border-surf-lowest text-[11px] font-[800] shadow-level-1 ${style.className}">` +
      `${style.glyph}</div>`,
    iconSize: [PIN_SIZE_PX, PIN_SIZE_PX],
    iconAnchor: [PIN_SIZE_PX / 2, PIN_SIZE_PX / 2],
  })
}

interface IncidentMapProps {
  pins: readonly IncidentPin[]
  /** The pin chosen from the table under the map: the map flies to it and opens its popup. */
  selection?: PinSelection | null
  /** Where the report's Back button should return to. */
  returnTo?: string
}

/** The incident map (chart 3.6). Follows GeofenceMap exactly: Leaflet's JS is imported inside
 *  an effect because it touches `window` at module scope, which would break the server render
 *  (risk R8); tiles come from lib/map/tiles.ts; a tile-server outage shows a message over the
 *  map instead of a grey void, and lifts on its own when tiles load again. The table under
 *  the map (in the card) lists every pin, for keyboard and screen-reader users. */
export function IncidentMap({ pins, selection = null, returnTo }: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let detachTiles: (() => void) | null = null

    async function init(): Promise<void> {
      try {
        const L = await import('leaflet')
        if (cancelled || containerRef.current === null || mapRef.current !== null) return
        // Scroll-wheel zoom starts off, so the page scrolls past the map instead of zooming it on
        // the way by. It switches on once the dispatcher clicks into the map (D25: Tom wanted to
        // zoom in further) and off again when the pointer leaves.
        const map = L.map(containerRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, scrollWheelZoom: false })
        map.on('click', () => map.scrollWheelZoom.enable())
        map.on('mouseout', () => map.scrollWheelZoom.disable())
        // Street, not satellite: this map is for reading where along a route problems cluster.
        // Its maxZoom (street level) is the map's own limit.
        const tiles = L.tileLayer(TILE_SOURCES.street.url, {
          attribution: TILE_SOURCES.street.attribution, maxZoom: TILE_SOURCES.street.maxZoom,
        }).addTo(map)
        detachTiles = attachTileFailureTracking(
          tiles,
          () => { if (!cancelled) setFailed(true) },
          () => { if (!cancelled) setFailed(false) },
        )
        layerRef.current = L.layerGroup().addTo(map)
        mapRef.current = map
        setReady(true)
      } catch {
        // Leaflet's chunk unreachable: say so; the table below still lists every pin.
        if (!cancelled) setFailed(true)
      }
    }

    void init()
    const markers = markersRef.current
    return () => {
      cancelled = true
      detachTiles?.()
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      markers.clear()
      setReady(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function placePins(): Promise<void> {
      const map = mapRef.current
      const layer = layerRef.current
      if (!ready || map === null || layer === null) return
      const L = await import('leaflet')
      if (cancelled) return
      layer.clearLayers()
      markersRef.current.clear()
      for (const pin of pins) {
        const marker = L.marker([pin.lat, pin.lng], {
          icon: pinIcon(L, pin.severity),
          keyboard: true,
          title: `${fmtExceptionType(pin.exception_type)} · ${COPY.severities[pin.severity]}`,
        })
          .bindPopup(buildPinPopup(pin, returnTo))
          .addTo(layer)
        markersRef.current.set(pin.exception_id, marker)
      }
      const [first] = pins
      if (pins.length === 1 && first !== undefined) {
        map.setView([first.lat, first.lng], SINGLE_PIN_ZOOM)
      } else if (pins.length > 1) {
        map.fitBounds(L.latLngBounds(pins.map((pin) => [pin.lat, pin.lng] as [number, number])), {
          padding: [FIT_PADDING_PX, FIT_PADDING_PX],
        })
      }
    }

    void placePins()
    return () => { cancelled = true }
  }, [pins, ready, returnTo])

  // A row chosen in the table: bring the map into view, fly to that pin and open its popup, as
  // if it had been clicked on the map itself (D25).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null || selection === null) return
    const marker = markersRef.current.get(selection.id)
    if (marker === undefined) return
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const target = marker.getLatLng()
    const zoom = Math.max(map.getZoom(), SELECTED_PIN_ZOOM)
    if (map.getZoom() === zoom && map.getCenter().equals(target)) {
      marker.openPopup()
      return
    }
    map.once('moveend', () => marker.openPopup())
    map.flyTo(target, zoom)
  }, [selection, ready])

  // `isolate` gives Leaflet's panes (z-index 400+) their own stacking context, so they can
  // never cover the chart cards' "i" popovers.
  return (
    <div className="relative isolate">
      <div ref={containerRef} style={{ height: INCIDENT_MAP_HEIGHT }} className="w-full overflow-hidden rounded-lg" />
      {failed && (
        <div role="status" className="absolute inset-0 z-[500] flex items-center justify-center rounded-lg bg-surf-low px-6 text-center text-[12px] text-on-surf-v">
          {COPY.mapUnavailable}
        </div>
      )}
    </div>
  )
}
