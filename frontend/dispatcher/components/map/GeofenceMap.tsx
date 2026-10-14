'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Circle, DivIcon, TileLayer } from 'leaflet'

// Static side-effect import (not dynamic, unlike Leaflet's JS below): inlines cleanly into
// this chunk and type-checks under this project's `moduleResolution: "bundler"` with no cast.
import 'leaflet/dist/leaflet.css'

import { TILE_ERROR_FALLBACK_THRESHOLD, TILE_SOURCES, type TileSourceKey } from '@/lib/map/tiles'

import { GeofenceSchematic } from './GeofenceSchematic'

const DEFAULT_ZOOM = 16

// Matches PrecinctForm's 5dp click/drag rounding (CLICK_COORDINATE_PRECISION), so an
// echoed gesture compares equal without relying on exact float equality.
const POSITION_ECHO_EPSILON_DEGREES = 0.00001

// Leaflet's color/fillColor options need a literal CSS colour, not a Tailwind class —
// styled via `className` instead so the `sec` token stays the single source of truth.
const GEOFENCE_CIRCLE_CLASS = 'fill-sec stroke-sec'

// Matches the centre dot GeofenceSchematic/StaticGeofenceThumbnail draw (r=4).
const PIN_DIAMETER_PX = 16

/**
 * Builds the precinct pin as a `divIcon` rather than Leaflet's default marker, which
 * 404s under a bundler that content-hashes asset URLs. Reuses the `sec` token instead
 * of Leaflet's hardcoded blue.
 */
function createPinIcon(L: typeof import('leaflet')): DivIcon {
  return L.divIcon({
    className: '', // suppresses Leaflet's default .leaflet-div-icon box/border
    html:
      `<div style="width:${PIN_DIAMETER_PX}px;height:${PIN_DIAMETER_PX}px" ` +
      `class="rounded-full bg-sec border-2 border-surf-lowest shadow-level-1"></div>`,
    iconSize: [PIN_DIAMETER_PX, PIN_DIAMETER_PX],
    // Centred, not tip-anchored: the pin is a dot ON the coordinate.
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
    // Fire once per failure episode, not on every error past the threshold.
    if (consecutiveErrors >= TILE_ERROR_FALLBACK_THRESHOLD && !exceeded) {
      exceeded = true
      onExceeded()
    }
  }

  // A success resets the streak so edge-of-coverage 404s don't accumulate across a healthy session.
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

interface GeofenceMapProps {
  latitude: number
  longitude: number
  radiusMetres: number
  /** Supplied only by the create/edit form. Omit for a read-only view. */
  onPositionChange?: (next: { latitude: number; longitude: number }) => void
  className?: string
}

/**
 * Renders the precinct's position and geofence on a real basemap. The only module that
 * imports Leaflet directly, loaded dynamically since it touches `window` at module
 * scope. Falls back to GeofenceSchematic if the chunk or tiles fail to load. Uses
 * `L.circle`'s metre-based radius so the fence stays accurate at every zoom.
 */
export function GeofenceMap({
  latitude,
  longitude,
  radiusMetres,
  onPositionChange,
  className,
}: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const circleRef = useRef<Circle | null>(null)
  const tileRef = useRef<TileLayer | null>(null)
  // Detaches the active tile layer's listeners; re-armed whenever the layer is (re)created.
  const tileFailureCleanupRef = useRef<(() => void) | null>(null)

  const [source, setSource] = useState<TileSourceKey>('satellite')
  const [failed, setFailed] = useState(false)
  // Bumped by "Retry map" to re-run init: a failed Leaflet import leaves no map at all,
  // so clearing `failed` alone wouldn't reveal a map (unlike a recovered tile outage).
  const [initAttempt, setInitAttempt] = useState(0)
  // True once the map exists. Needed as a dependency below so a tile-source toggle
  // pressed mid-import still gets applied once the map is ready.
  const [mapReady, setMapReady] = useState(false)

  // Ref avoids re-initialising Leaflet (and fighting the user's pan) on every parent render.
  const onPositionChangeRef = useRef(onPositionChange)
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  // Set on every click/drag so the follow-effect can distinguish an echo of this map's
  // own gesture from a coordinate that came from the form fields.
  const lastEmittedPositionRef = useRef<{ latitude: number; longitude: number } | null>(null)

  // Runs once; position/radius/tile changes are applied by the effects below.
  useEffect(() => {
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const L = await import('leaflet')
        if (cancelled || containerRef.current === null || mapRef.current !== null) return

        const map = L.map(containerRef.current, {
          center: [latitude, longitude],
          zoom: DEFAULT_ZOOM,
          // Disabled so scrolling the form past the map doesn't zoom it.
          scrollWheelZoom: false,
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
        // Chunk or tiles unreachable — fall back to the schematic.
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
    }
    // Only initAttempt: re-running on a coordinate change would reset the user's pan mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initAttempt])

  // Pan to a typed/pasted coordinate, but not to one that echoes this map's own click/drag.
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
    // Re-checked after each await: mapRef.current can be nulled mid-flight (e.g. the
    // dispatcher navigates away), and without this the resumed callback would call
    // `.addTo(null)` and throw.
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
    // mapReady as a dependency ensures a source chosen before Leaflet finishes loading is still applied.
  }, [source, mapReady])

  // The schematic is an overlay, not a replacement — the map stays mounted beneath it,
  // so a tile that succeeds after an outage resets the streak and the overlay lifts on its own.
  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />

      {failed && (
        <div
          className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 bg-surf-low rounded-lg"
          role="status"
        >
          <GeofenceSchematic radiusMetres={radiusMetres} className="w-[200px] h-[200px]" />
          <p className="text-[11px] text-on-surf-v">
            Map unavailable — showing the geofence to scale.
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
