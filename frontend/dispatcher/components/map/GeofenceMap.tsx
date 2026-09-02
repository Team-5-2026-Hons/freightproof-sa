'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Circle, DivIcon, TileLayer } from 'leaflet'

// A static side-effect import, not a dynamic one: it carries no `window` access (unlike
// Leaflet's JS, loaded dynamically below), Next's CSS loader inlines it into this
// component's own chunk exactly like `app/layout.tsx` does for `globals.css`, and —
// unlike a dynamic `import('leaflet/dist/leaflet.css')`, which `tsc` cannot resolve
// under this project's `moduleResolution: "bundler"` with no ambient `.d.ts` to declare
// it in (out of this component's file scope) — a static side-effect import of a plain
// CSS file type-checks cleanly with no ambient declaration and no `any` cast needed.
import 'leaflet/dist/leaflet.css'

import { OSM_TILE_URL_TEMPLATE } from '@/lib/map/tiles'

import { GeofenceSchematic } from './GeofenceSchematic'

// Tile sources. Both are keyless; attribution is required by each provider's terms and
// is rendered by Leaflet's own attribution control, so do not strip it.
//
// Satellite is the default because the task is "put this pin on that building", and a
// street map cannot answer it. Street is the toggle for reading road access and names.
const TILE_SOURCES = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri',
    maxZoom: 19,
  },
  street: {
    // Shared with the list thumbnail rather than spelled out again here, so the tile
    // provider is named in exactly one place. Note this is the keyless single host —
    // NOT the `{s}.tile.openstreetmap.org` subdomain form, which OSM has deprecated.
    label: 'Street',
    url: OSM_TILE_URL_TEMPLATE,
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
} as const

type TileSourceKey = keyof typeof TILE_SOURCES

const DEFAULT_ZOOM = 16

// The parent (PrecinctForm) rounds a click/drag position to 5dp before it round-trips
// back here as props (CLICK_COORDINATE_PRECISION) — comparing against the raw value
// this component emitted with exact equality would almost never match, so "this is an
// echo of our own gesture" means "within one such rounding step", not identical.
const POSITION_ECHO_EPSILON_DEGREES = 0.00001

// A handful of individual tile failures (an edge-of-coverage 404, one dropped request)
// is normal on a healthy map and must not trip the fallback. This many tile errors IN A
// ROW, with no successful tile load between them, is the signature of the tile SERVER
// being unreachable — the exact "venue wifi" case the schematic fallback exists for.
// Chosen empirically: low enough to catch a dead connection within the first screenful
// of tiles at DEFAULT_ZOOM (which covers roughly half a dozen), high enough that a
// merely spotty connection does not flicker into the schematic.
const TILE_ERROR_FALLBACK_THRESHOLD = 6

// Leaflet's vector-layer `color`/`fillColor` options only accept a literal CSS colour
// string — they can't consume a Tailwind class. Rather than hardcode the hex value
// (banned by this repo's eslint no-restricted-syntax rule, and a second source of
// truth for the `sec` token in tailwind.config.ts), the circle is styled by handing
// Leaflet a `className` instead; Leaflet applies it to the SVG path it draws, and CSS
// class rules always win over the presentation-attribute defaults Leaflet also sets.
const GEOFENCE_CIRCLE_CLASS = 'fill-sec stroke-sec'

// Diameter of the pin marking the precinct's exact point. Matches the centre dot
// GeofenceSchematic and StaticGeofenceThumbnail draw (r=4), so the same fact looks the
// same on all three surfaces.
const PIN_DIAMETER_PX = 16

/**
 * The precinct pin, as a `divIcon` rather than Leaflet's default marker.
 *
 * Leaflet's default icon has no usable URL under a bundler that content-hashes assets.
 * `Icon.Default._stripUrl` recovers the image directory by matching the CSS background
 * against `/^(.*)marker-icon\.png$/`, but Next emits the file as
 * `marker-icon.<hash>.png`, so the match fails; detection then falls through to a
 * `link[href$="leaflet.css"]` lookup that Next never produces either (its CSS ships as
 * hashed chunks). The result is `imagePath = ''` and a relative `marker-icon.png`
 * request resolved against the current route — a 404, an invisible marker, and nothing
 * to drag on the create/edit form.
 *
 * A divIcon carries its own markup and no asset path, so it cannot break that way, and
 * it lets the pin use the same `sec` token as the geofence circle instead of a second
 * hardcoded blue.
 */
function createPinIcon(L: typeof import('leaflet')): DivIcon {
  return L.divIcon({
    // Empty, to suppress Leaflet's default .leaflet-div-icon white box/border.
    className: '',
    // Size comes from PIN_DIAMETER_PX rather than a `w-4 h-4` pair, so the markup and
    // the iconSize/iconAnchor below cannot drift apart. Colour stays on the tokens.
    html:
      `<div style="width:${PIN_DIAMETER_PX}px;height:${PIN_DIAMETER_PX}px" ` +
      `class="rounded-full bg-sec border-2 border-surf-lowest shadow-level-1"></div>`,
    iconSize: [PIN_DIAMETER_PX, PIN_DIAMETER_PX],
    // Centred, not tip-anchored: this pin is a dot ON the coordinate, so its middle is
    // the point being placed.
    iconAnchor: [PIN_DIAMETER_PX / 2, PIN_DIAMETER_PX / 2],
  })
}

/**
 * Trips `onExceeded` after TILE_ERROR_FALLBACK_THRESHOLD consecutive `tileerror` events
 * with no intervening `tileload`.
 *
 * `L.tileLayer(...).addTo(map)` returns synchronously and never throws when the tile
 * IMAGES fail to load — Leaflet fetches them asynchronously in the background, so a
 * `try/catch` around map init cannot see this. This is the realistic "bad wifi" case:
 * this app's own JS is same-origin and loads fine, but the external Esri/OSM tile CDN
 * is unreachable, and every tile request errors — with nothing listening for
 * `tileerror`, that renders exactly the grey broken-tile void the fallback exists to
 * prevent. Returns a cleanup function so the caller can detach before swapping or
 * removing the layer.
 *
 * Exported (not just used internally) so this threshold/reset logic — the part of the
 * component with actual branching to get wrong — can be exercised directly against a
 * fake layer, without needing a real Leaflet map or a browser.
 */
export function attachTileFailureTracking(layer: TileLayer, onExceeded: () => void): () => void {
  let consecutiveErrors = 0

  const handleTileError = (): void => {
    consecutiveErrors += 1
    if (consecutiveErrors >= TILE_ERROR_FALLBACK_THRESHOLD) {
      onExceeded()
    }
  }

  // Any successful load proves the server IS reachable — a few real 404s at the edge of
  // a coverage area should not accumulate toward the threshold across an otherwise
  // healthy session.
  const handleTileLoad = (): void => {
    consecutiveErrors = 0
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
 * The precinct's position and geofence on a real basemap.
 *
 * The only module permitted to import Leaflet — everything else takes this component,
 * so the tile provider or the library itself can change without touching a page.
 *
 * Leaflet is loaded with a dynamic import inside an effect rather than a static import
 * because it touches `window` at module scope, which breaks any server render. The
 * import also gives us the failure signal for the schematic fallback: if the chunk or
 * the tiles cannot be fetched, we show a correct diagram instead of an empty grey box.
 *
 * `L.circle` takes its radius in METRES, which is the entire reason this library was
 * chosen — the fence stays true at every zoom with no projection maths of our own.
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
  // Detaches the current tile layer's tileerror/tileload listeners — re-armed every
  // time the tile layer is (re)created, whether at init or on a source swap.
  const tileFailureCleanupRef = useRef<(() => void) | null>(null)

  const [source, setSource] = useState<TileSourceKey>('satellite')
  const [failed, setFailed] = useState(false)

  // Held in a ref so the map-init effect never re-runs when the callback identity
  // changes — re-initialising Leaflet on every parent render would fight the user's pan.
  const onPositionChangeRef = useRef(onPositionChange)
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  // Set right before every onPositionChange call (click or drag) so the coordinate-
  // follow effect below can tell "this prop change is the echo of a gesture the
  // dispatcher already saw happen on this map" apart from "this came from the form
  // fields, and has never been shown on screen" — only the latter should pan the view.
  const lastEmittedPositionRef = useRef<{ latitude: number; longitude: number } | null>(null)

  // Init once. Position, radius and tile changes are applied by the effects below
  // rather than by tearing the map down and rebuilding it.
  useEffect(() => {
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const L = await import('leaflet')
        if (cancelled || containerRef.current === null || mapRef.current !== null) return

        const map = L.map(containerRef.current, {
          center: [latitude, longitude],
          zoom: DEFAULT_ZOOM,
          // The pin is placed by clicking, so a scroll-wheel zoom that fires while the
          // dispatcher is scrolling the FORM past the map is pure annoyance.
          scrollWheelZoom: false,
        })

        const chosen = TILE_SOURCES.satellite
        tileRef.current = L.tileLayer(chosen.url, {
          attribution: chosen.attribution,
          maxZoom: chosen.maxZoom,
        }).addTo(map)
        tileFailureCleanupRef.current = attachTileFailureTracking(tileRef.current, () => {
          if (!cancelled) setFailed(true)
        })

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
      } catch {
        // Chunk or tiles unreachable. The schematic is a correct answer to a narrower
        // question, which beats a blank frame.
        if (!cancelled) setFailed(true)
      }
    }

    void init()

    return () => {
      cancelled = true
      tileFailureCleanupRef.current?.()
      tileFailureCleanupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
      tileRef.current = null
    }
    // Deliberately empty: this effect builds the map once. The effects below keep it
    // in sync. Re-running it on a coordinate change would reset the user's pan mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the form's coordinates. A click or drag already showed the dispatcher
  // exactly where they placed the pin, so re-panning there would fight their own
  // gesture — but a typed or pasted coordinate has never been on screen, and the whole
  // point of showing a map next to the fields is to let the dispatcher confirm it. So:
  // pan only when this change did NOT originate from this map's own click/drag.
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
    // Mirrors the init effect's `cancelled` guard: the map-init effect's cleanup can
    // null `mapRef.current` (and detach the old layer's tile-failure tracking) while
    // this `await` is in flight — e.g. the dispatcher navigates away right after
    // toggling the tile source. Without re-checking after every await, the resumed
    // callback would call `.addTo(null)` and throw as an unhandled rejection.
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
      })
    }

    void swapTiles()

    return () => {
      cancelled = true
    }
  }, [source])

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-surf-low rounded-lg ${className ?? ''}`}>
        <GeofenceSchematic radiusMetres={radiusMetres} className="w-[200px] h-[200px]" />
        <p className="text-[11px] text-on-surf-v">
          Map unavailable — showing the geofence to scale.
        </p>
      </div>
    )
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />
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
