'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Circle, DivIcon, TileLayer, Polygon as LeafletPolygon, LatLng } from 'leaflet'

import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

import { TILE_ERROR_FALLBACK_THRESHOLD, TILE_SOURCES, type TileSourceKey } from '@/lib/map/tiles'
import type { LatLngPair } from '@shared/lib/types/precinct'

import { GeofenceSchematic } from './GeofenceSchematic'

const DEFAULT_ZOOM = 16

const POSITION_ECHO_EPSILON_DEGREES = 0.00001

const GEOFENCE_CIRCLE_CLASS = 'fill-sec stroke-sec'

const PIN_DIAMETER_PX = 16

const OUTLINE_COORDINATE_DECIMALS = 7

const OUTLINE_FIT_PADDING_PX = 24

function roundCoordinate(value: number): number {
  const factor = 10 ** OUTLINE_COORDINATE_DECIMALS
  return Math.round(value * factor) / factor
}

/** The outer ring of a Leaflet polygon as [lat, lng] pairs. getLatLngs() nests rings
 *  (outer first) for a polygon; holes are never created here, so only [0] matters. */
function ringFromLayer(layer: LeafletPolygon): LatLngPair[] {
  const rings = layer.getLatLngs() as LatLng[][]
  return (rings[0] ?? []).map((p) => [roundCoordinate(p.lat), roundCoordinate(p.lng)])
}

function sameOutline(a: readonly LatLngPair[] | null, b: readonly LatLngPair[] | null | undefined): boolean {
  if (a === null || b == null || a.length !== b.length) return false
  return a.every(([lat, lng], i) => lat === b[i][0] && lng === b[i][1])
}

/**
 * Builds the precinct pin as a `divIcon` rather than Leaflet's default marker, which
 * 404s under a bundler that content-hashes asset URLs. Reuses the `sec` token instead
 * of Leaflet's hardcoded blue.
 */
function createPinIcon(L: typeof import('leaflet')): DivIcon {
  return L.divIcon({
    className: '',
    html:
      `<div style="width:${PIN_DIAMETER_PX}px;height:${PIN_DIAMETER_PX}px" ` +
      `class="rounded-full bg-sec border-2 border-surf-lowest shadow-level-1"></div>`,
    iconSize: [PIN_DIAMETER_PX, PIN_DIAMETER_PX],
    iconAnchor: [PIN_DIAMETER_PX / 2, PIN_DIAMETER_PX / 2],
  })
}

/**
 * Fires `onExceeded` after TILE_ERROR_FALLBACK_THRESHOLD consecutive `tileerror` events
 * with no intervening `tileload` (Leaflet never throws when tile images fail to load, so
 * this is the only signal for a dead tile CDN). `onRecovered` fires on the first
 * successful tile after that, so a transient outage doesn't permanently replace the map.
 * Returns a cleanup function. Exported for direct testing — see __tests__/GeofenceMap.test.tsx.
 */
export function attachTileFailureTracking(
  layer: TileLayer,
  onExceeded: () => void,
  onRecovered?: () => void,
): () => void {
  let consecutiveErrors = 0
  let exceeded = false

  const handleTileError = (): void => {
    consecutiveErrors += 1
    if (consecutiveErrors >= TILE_ERROR_FALLBACK_THRESHOLD && !exceeded) {
      exceeded = true
      onExceeded()
    }
  }

  const handleTileLoad = (): void => {
    consecutiveErrors = 0
    if (exceeded) {
      exceeded = false
      onRecovered?.()
    }
  }

  layer.on('tileerror', handleTileError)
  layer.on('tileload', handleTileLoad)

  return () => {
    layer.off('tileerror', handleTileError)
    layer.off('tileload', handleTileLoad)
  }
}

export const GEOFENCE_MAP_INTERACTION = { scrollWheelZoom: true } as const

interface GeofenceMapProps {
  latitude: number
  longitude: number
  radiusMetres: number
  polygon?: readonly LatLngPair[] | null
  showCircle?: boolean
  /** Supplied only by the create/edit form. Omit for a read-only view. */
  onPositionChange?: (next: { latitude: number; longitude: number }) => void
  /** Supplied by the form to make the outline editable (drag corners, add/remove points). */
  onPolygonChange?: (next: LatLngPair[]) => void
  className?: string
}

/**
 * Renders the precinct's position and geofence on a real basemap. The only module that
 * imports Leaflet directly, loaded dynamically since it touches `window` at module
 * scope. Falls back to GeofenceSchematic if the chunk or tiles fail to load. Uses
 * `L.circle`'s metre-based radius so the fence stays accurate at every zoom; an outline,
 * when present, is drawn in place of the circle and edited with Leaflet-Geoman.
 */
export function GeofenceMap({
  latitude,
  longitude,
  radiusMetres,
  polygon = null,
  showCircle = true,
  onPositionChange,
  onPolygonChange,
  className,
}: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const circleRef = useRef<Circle | null>(null)
  const tileRef = useRef<TileLayer | null>(null)
  const polygonRef = useRef<LeafletPolygon | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const tileFailureCleanupRef = useRef<(() => void) | null>(null)

  const [source, setSource] = useState<TileSourceKey>('satellite')
  const [failed, setFailed] = useState(false)
  const [initAttempt, setInitAttempt] = useState(0)
  const [mapReady, setMapReady] = useState(false)

  const onPositionChangeRef = useRef(onPositionChange)
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  const onPolygonChangeRef = useRef(onPolygonChange)
  useEffect(() => {
    onPolygonChangeRef.current = onPolygonChange
  }, [onPolygonChange])

  const lastEmittedPolygonRef = useRef<LatLngPair[] | null>(null)

  const lastEmittedPositionRef = useRef<{ latitude: number; longitude: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const L = await import('leaflet')
        if (onPolygonChangeRef.current !== undefined) {
          await import('@geoman-io/leaflet-geoman-free')
        }
        if (cancelled || containerRef.current === null || mapRef.current !== null) return
        leafletRef.current = L

        const map = L.map(containerRef.current, {
          center: [latitude, longitude],
          zoom: DEFAULT_ZOOM,
          ...GEOFENCE_MAP_INTERACTION,
        })

        const chosen = TILE_SOURCES.satellite
        tileRef.current = L.tileLayer(chosen.url, {
          attribution: chosen.attribution,
          maxZoom: chosen.maxZoom,
        }).addTo(map)
        tileFailureCleanupRef.current = attachTileFailureTracking(
          tileRef.current,
          () => { if (!cancelled) setFailed(true) },
          () => { if (!cancelled) setFailed(false) },
        )

        circleRef.current = L.circle([latitude, longitude], {
          radius: radiusMetres,
          className: GEOFENCE_CIRCLE_CLASS,
          weight: 1.5,
          fillOpacity: 0.1,
        }).addTo(map)

        markerRef.current = L.marker([latitude, longitude], {
          icon: createPinIcon(L),
          draggable: onPositionChangeRef.current !== undefined,
        }).addTo(map)

        if (onPositionChangeRef.current !== undefined) {
          map.on('click', (e) => {
            lastEmittedPositionRef.current = { latitude: e.latlng.lat, longitude: e.latlng.lng }
            onPositionChangeRef.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng })
          })
          markerRef.current.on('dragend', () => {
            const pos = markerRef.current?.getLatLng()
            if (pos) {
              lastEmittedPositionRef.current = { latitude: pos.lat, longitude: pos.lng }
              onPositionChangeRef.current?.({ latitude: pos.lat, longitude: pos.lng })
            }
          })
        }

        mapRef.current = map
        setMapReady(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    void init()

    return () => {
      cancelled = true
      setMapReady(false)
      tileFailureCleanupRef.current?.()
      tileFailureCleanupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
      tileRef.current = null
      polygonRef.current = null
      leafletRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initAttempt])

  useEffect(() => {
    markerRef.current?.setLatLng([latitude, longitude])
    circleRef.current?.setLatLng([latitude, longitude])

    const lastEmitted = lastEmittedPositionRef.current
    const isEchoOfOwnGesture =
      lastEmitted !== null &&
      Math.abs(lastEmitted.latitude - latitude) < POSITION_ECHO_EPSILON_DEGREES &&
      Math.abs(lastEmitted.longitude - longitude) < POSITION_ECHO_EPSILON_DEGREES

    if (!isEchoOfOwnGesture) {
      mapRef.current?.panTo([latitude, longitude])
    }
  }, [latitude, longitude])

  useEffect(() => {
    circleRef.current?.setRadius(radiusMetres)
  }, [radiusMetres])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    const circle = circleRef.current
    if (!mapReady || map === null || L === null) return

    const outline = polygon !== null && polygon.length >= 3 ? polygon : null
    if (circle !== null) {
      const wantCircle = outline === null && showCircle
      if (!wantCircle && map.hasLayer(circle)) circle.remove()
      if (wantCircle && !map.hasLayer(circle)) circle.addTo(map)
    }

    if (sameOutline(lastEmittedPolygonRef.current, outline)) return

    polygonRef.current?.remove()
    polygonRef.current = null
    lastEmittedPolygonRef.current = null
    if (outline === null) return

    const layer = L.polygon(outline.map(([lat, lng]) => [lat, lng] as [number, number]), {
      className: GEOFENCE_CIRCLE_CLASS,
      weight: 1.5,
      fillOpacity: 0.1,
    }).addTo(map)

    if (onPolygonChangeRef.current !== undefined) {
      layer.pm.enable({ allowSelfIntersection: false })
      layer.on('pm:edit', () => {
        const next = ringFromLayer(layer)
        lastEmittedPolygonRef.current = next
        onPolygonChangeRef.current?.(next)
      })
    }

    polygonRef.current = layer
    map.fitBounds(layer.getBounds(), { padding: [OUTLINE_FIT_PADDING_PX, OUTLINE_FIT_PADDING_PX] })
  }, [polygon, showCircle, mapReady])

  useEffect(() => {
    let cancelled = false

    async function swapTiles(): Promise<void> {
      if (mapRef.current === null) return
      const L = await import('leaflet')
      const map = mapRef.current
      if (cancelled || map === null) return

      const chosen = TILE_SOURCES[source]
      tileFailureCleanupRef.current?.()
      tileRef.current?.remove()
      tileRef.current = L.tileLayer(chosen.url, {
        attribution: chosen.attribution,
        maxZoom: chosen.maxZoom,
      }).addTo(map)
      tileFailureCleanupRef.current = attachTileFailureTracking(tileRef.current, () => {
        if (!cancelled) setFailed(true)
      }, () => {
        if (!cancelled) setFailed(false)
      })
    }

    void swapTiles()

    return () => {
      cancelled = true
    }
  }, [source, mapReady])

  useEffect(() => {
    const container = containerRef.current
    if (!mapReady || container === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [mapReady])

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />

      {failed && (
        <div
          className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 bg-surf-low rounded-lg"
          role="status"
        >
          <GeofenceSchematic
            radiusMetres={radiusMetres}
            polygon={polygon}
            centre={[latitude, longitude]}
            className="w-[200px] h-[200px]"
          />
          <p className="text-[11px] text-on-surf-v">
            Map unavailable. Showing the geofence to scale.
          </p>
          <button
            type="button"
            onClick={() => {
              setFailed(false)
              setInitAttempt((attempt) => attempt + 1)
            }}
            className="px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf"
          >
            Retry map
          </button>
        </div>
      )}

      <div className="absolute top-3 right-3 z-[400] flex items-center gap-[2px] bg-surf-lowest rounded-md p-[3px] shadow-level-1">
        {(Object.keys(TILE_SOURCES) as TileSourceKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSource(key)}
            className={
              source === key
                ? 'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase bg-surf-low text-on-surf'
                : 'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf'
            }
          >
            {TILE_SOURCES[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}
