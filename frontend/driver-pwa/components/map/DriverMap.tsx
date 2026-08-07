// frontend/driver-pwa/components/map/DriverMap.tsx
'use client'

// Where the driver is, on the driving screen. EVIDENCE, NOT OPERATIONS: this shows a
// position, it does not route, reroute or navigate — there is no destination on this map
// and no directions call anywhere in this file.
//
// The single rule this component is built around: IT MUST NEVER RENDER A PLAUSIBLE-LOOKING
// WRONG POSITION. A grey half-loaded tile pane centred on a default coordinate is worse
// than no map at all, because a driver reads it as "this is where I am". Every failure
// therefore degrades to something explicitly labelled, in this order:
//
//   1. No API key configured  -> coordinates card + "Open in Maps" handoff to the phone's
//                                own map app. The key is genuinely optional (the APK has
//                                to build without one), so this is a normal state.
//   2. Key present, tiles unreachable (offline, dead zone, blocked script)
//                             -> the same coordinates card, carrying the fix's own
//                                timestamp so a stale one reads as last known.
//   3. No GPS fix at all      -> an honest "position unavailable" panel. Nothing is drawn.
//
// POPIA: this component never transmits a coordinate. It receives one from the caller
// (which sources it from LocationContext) and draws it locally. The Maps JS API does
// send tile requests to Google, which is why an absent key degrades rather than
// half-works.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { Loader2, MapPinOff, Navigation, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GOOGLE_MAPS_API_KEY } from '@/lib/constants/env'
import { formatTime } from '@/lib/utils/format-time'
import { Button } from '@/components/ui/Button'
import type { DriverPosition } from '@/lib/types/location'

// Street level: about a kilometre across on a phone, which is the scale that answers
// "which road am I on" without the driver having to pinch.
const MAP_ZOOM = 15

// Drawn radius of the "you are here" dot, in metres of ground distance. A fixed metre
// radius (rather than a pixel marker) keeps the dot honestly proportional to the accuracy
// halo it sits inside as the map zooms.
const DRIVER_DOT_RADIUS_M = 12

// Used only when the platform reports no accuracy figure at all. Deliberately generous:
// under-drawing the uncertainty is the failure mode that misleads.
const FALLBACK_ACCURACY_RADIUS_M = 50

// Opacity of the accuracy halo. Named because two call sites (fill and stroke) have to
// agree, and because a magic 0.15 in a circle option reads as noise.
const ACCURACY_FILL_OPACITY = 0.15
const ACCURACY_STROKE_OPACITY = 0.4

// ~1.1 m of ground resolution at the equator — finer than any consumer GPS fix, so this
// neither throws away precision nor invents it.
const COORDINATE_DECIMALS = 5

// Past this age a fix is presented as "last known" rather than as where the driver is.
// One minute: long enough that a normal refresh cycle never trips it, short enough that a
// driver who has moved since the last successful fix is told so.
const STALE_FIX_MS = 60_000

// Design-system colours, resolved at runtime from the --fp-* CSS variables in
// app/globals.css rather than hardcoded. Two reasons: the Maps JS API takes a colour
// STRING (an SVG presentation attribute, which cannot resolve `var()` itself), and the
// driver's chosen theme has to swap the palette underneath the map like it does
// everywhere else. eslint bans hex literals outside lib/tokens.ts for the same reason.
const DRIVER_COLOUR_VAR = '--fp-secondary'
// Only reached if the stylesheet has not applied (jsdom, or a CSS load failure). A
// visible mid-blue is better than an invisible circle; it is never the shipped colour.
const DRIVER_COLOUR_FALLBACK = 'rgb(0 81 213)'

function tokenColour(variable: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  // globals.css stores triples ("0 81 213"), not colour strings — wrap, don't trust.
  return raw === '' ? fallback : `rgb(${raw})`
}

// `setOptions` must run before the first library load and must not be re-run afterwards,
// so it is latched at module scope rather than in an effect that remounts with the screen.
let mapsOptionsApplied = false

function applyMapsOptions(apiKey: string): void {
  if (mapsOptionsApplied) return
  setOptions({ key: apiKey })
  mapsOptionsApplied = true
}

/**
 * Deep link that hands the position to the phone's own map application.
 *
 * Per-platform on purpose: `geo:` is the Android intent scheme, `maps://` is Apple's, and
 * a browser has neither. This is a HANDOFF, not navigation — it opens the coordinate,
 * it does not request a route.
 */
function nativeMapsUrl(position: DriverPosition): string {
  const latLng = `${position.lat},${position.lng}`
  switch (Capacitor.getPlatform()) {
    case 'android':
      return `geo:${latLng}?q=${encodeURIComponent(latLng)}`
    case 'ios':
      return `maps://?ll=${latLng}&q=${encodeURIComponent(latLng)}`
    default:
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latLng)}`
  }
}

function formatCoordinate(value: number): string {
  return value.toFixed(COORDINATE_DECIMALS)
}

function isStale(capturedAt: string | null, now: number): boolean {
  if (capturedAt === null) return true
  const takenAt = new Date(capturedAt).getTime()
  // An unparseable timestamp is treated as stale — the cautious reading, never the
  // flattering one.
  if (Number.isNaN(takenAt)) return true
  return now - takenAt > STALE_FIX_MS
}

/** Why the map itself is not on screen. Drives the coordinates card's headline copy. */
type FallbackReason = 'no-key' | 'tiles-unreachable'

interface CoordinatesCardProps {
  position: DriverPosition
  capturedAt: string | null
  reason: FallbackReason
  className?: string
}

// Rungs 1 and 2 of the ladder. Identical content, different headline: the driver needs to
// know their position either way, and needs to know WHY there is no map so they can tell a
// build without a key apart from a dead zone that will clear.
function CoordinatesCard({ position, capturedAt, reason, className }: CoordinatesCardProps) {
  const stale = isStale(capturedAt, Date.now())

  return (
    <div
      className={cn(
        'flex flex-col justify-center gap-3 rounded-xl bg-surface-container-low p-5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {reason === 'tiles-unreachable'
          ? <WifiOff className="h-5 w-5 shrink-0 text-surface-on-variant" strokeWidth={2} aria-hidden />
          : <MapPinOff className="h-5 w-5 shrink-0 text-surface-on-variant" strokeWidth={2} aria-hidden />}
        <p className="text-base font-semibold text-surface-on">
          {reason === 'tiles-unreachable' ? 'Map unavailable offline' : 'Map not available on this build'}
        </p>
      </div>

      <p className="text-sm text-surface-on-variant">
        {reason === 'tiles-unreachable'
          ? 'No connection for map tiles. Your position below still comes from the phone GPS, which works without signal.'
          : 'No map key is configured. Your position below still comes from the phone GPS.'}
      </p>

      <div className="rounded-xl bg-surface-container-lowest p-4">
        <p className="text-xs uppercase tracking-industrial text-surface-on-variant">
          {stale ? 'Last known position' : 'Current position'}
        </p>
        <p className="mt-1 font-mono text-lg font-semibold text-surface-on">
          {formatCoordinate(position.lat)}, {formatCoordinate(position.lng)}
        </p>
        <p className="mt-1 text-sm text-surface-on-variant">
          {position.accuracyM !== null
            ? `Accurate to about ${Math.round(position.accuracyM)} m`
            : 'Accuracy not reported by this device'}
          {capturedAt !== null && ` · fix taken ${formatTime(capturedAt)}`}
        </p>
      </div>

      {/* A real anchor, not a router push: the target is the phone's own map application
          (a geo:/maps: intent scheme on device), and a WebView hands those off far more
          reliably from an <a href> than from a scripted location assignment.
          Hand-styled to match Button variant="secondary" size="lg" rather than using
          `<Button asChild>` — that path throws "Slot failed to slot onto its children"
          with the installed @radix-ui/react-slot, because Button always passes three
          children (iconLeft, children, iconRight) into Slot. Pre-existing, also affects
          app/error.tsx; both are outside this change's scope. */}
      <a
        href={nativeMapsUrl(position)}
        rel="noopener noreferrer"
        className={cn(
          'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-6 py-4',
          'text-sm font-bold uppercase tracking-wider transition-all duration-200 active:scale-[0.98]',
          'border border-outline-variant/60 bg-surface-container-lowest text-surface-on shadow-ambient-sm',
          'hover:bg-surface-container-low',
        )}
      >
        <Navigation className="h-4 w-4" strokeWidth={2} aria-hidden />
        Open in Maps
      </a>
    </div>
  )
}

interface NoFixPanelProps {
  onRetry?: () => void
  className?: string
}

// Rung 3. Nothing is drawn, because there is nothing true to draw.
function NoFixPanel({ onRetry, className }: NoFixPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl bg-surface-container-low p-6 text-center',
        className,
      )}
    >
      <MapPinOff className="h-8 w-8 text-surface-on-variant" strokeWidth={1.5} aria-hidden />
      <p className="text-base font-semibold text-surface-on">Position unavailable</p>
      <p className="text-sm text-surface-on-variant">
        Your phone has not produced a location fix yet. Check that location is switched on
        and that this app is allowed to use it.
      </p>
      {onRetry !== undefined && (
        <Button variant="secondary" size="md" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export interface DriverMapProps {
  /** The latest fix the caller holds, or null when the phone has produced none. */
  position: DriverPosition | null
  /** ISO timestamp of `position`, used to label a stale fix honestly. */
  capturedAt: string | null
  /** Re-request a fix. Omit to render the no-fix state without a retry control. */
  onRetry?: () => void
  className?: string
}

/** Whether the Maps JS API is usable right now. */
type MapState = 'loading' | 'ready' | 'unavailable'

export function DriverMap({ position, capturedAt, onRetry, className }: DriverMapProps) {
  const [mapState, setMapState] = useState<MapState>('loading')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const driverDotRef = useRef<google.maps.Circle | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)

  const hasKey = GOOGLE_MAPS_API_KEY !== ''

  // Load the API and build the map exactly once per successful attempt. Gated on an
  // existing fix: the map is only ever centred on a real reading, never on a default
  // coordinate that would render as a confident lie.
  useEffect(() => {
    if (!hasKey || position === null || mapState !== 'loading' || mapRef.current !== null) return

    const container = containerRef.current
    if (container === null) return

    let cancelled = false
    const centre = { lat: position.lat, lng: position.lng }
    const driverColour = tokenColour(DRIVER_COLOUR_VAR, DRIVER_COLOUR_FALLBACK)

    applyMapsOptions(GOOGLE_MAPS_API_KEY)
    importLibrary('maps')
      .then(({ Map, Circle }) => {
        if (cancelled) return

        const map = new Map(container, {
          center: centre,
          zoom: MAP_ZOOM,
          // A driver's screen, not a mapping tool: no controls to fat-finger, one-finger
          // panning (`greedy`), and no tappable POIs to open a place card by accident.
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: false,
        })

        // The halo is the uncertainty, drawn to scale. It is what stops a 500 m fix from
        // reading as a pinpoint.
        accuracyRef.current = new Circle({
          map,
          center: centre,
          radius: position.accuracyM ?? FALLBACK_ACCURACY_RADIUS_M,
          strokeColor: driverColour,
          strokeOpacity: ACCURACY_STROKE_OPACITY,
          strokeWeight: 1,
          fillColor: driverColour,
          fillOpacity: ACCURACY_FILL_OPACITY,
          clickable: false,
        })
        driverDotRef.current = new Circle({
          map,
          center: centre,
          radius: DRIVER_DOT_RADIUS_M,
          strokeColor: driverColour,
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: driverColour,
          fillOpacity: 1,
          clickable: false,
        })

        mapRef.current = map
        setMapState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Offline, a dead zone, a blocked script, a rejected key. Logged (never swallowed)
        // and shown to the driver as the coordinates card — not as an empty grey pane.
        console.warn('[DriverMap] Google Maps JS API could not be loaded', err)
        setMapState('unavailable')
      })

    return () => { cancelled = true }
  }, [hasKey, position, mapState])

  // Follow the driver. Re-centring on every fix is what makes this a driving screen
  // rather than a still photograph of where the trip started.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || position === null) return

    const centre = { lat: position.lat, lng: position.lng }
    map.setCenter(centre)
    driverDotRef.current?.setCenter(centre)
    accuracyRef.current?.setCenter(centre)
    accuracyRef.current?.setRadius(position.accuracyM ?? FALLBACK_ACCURACY_RADIUS_M)
  }, [position, mapState])

  // Release the Maps objects when the driving screen unmounts, so a long trip that opens
  // and closes this screen repeatedly does not accumulate detached map instances.
  useEffect(() => () => {
    driverDotRef.current?.setMap(null)
    accuracyRef.current?.setMap(null)
    driverDotRef.current = null
    accuracyRef.current = null
    mapRef.current = null
  }, [])

  // A dead zone clears when the truck comes out of it — retry the load rather than
  // leaving the driver on the fallback card for the rest of the leg.
  const retryTiles = useCallback(() => {
    if (mapRef.current !== null) return
    setMapState('loading')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('online', retryTiles)
    return () => window.removeEventListener('online', retryTiles)
  }, [retryTiles])

  // ── The degradation ladder, in order ────────────────────────────────────────────────
  // Rung 3 first: with no fix there is no coordinate for rungs 1 and 2 to show either.
  if (position === null) return <NoFixPanel onRetry={onRetry} className={className} />
  if (!hasKey) return <CoordinatesCard position={position} capturedAt={capturedAt} reason="no-key" className={className} />
  if (mapState === 'unavailable') {
    return <CoordinatesCard position={position} capturedAt={capturedAt} reason="tiles-unreachable" className={className} />
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-surface-container-low', className)}>
      <div ref={containerRef} role="region" aria-label="Map of your current position" className="h-full w-full" />
      {mapState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-container-low">
          <Loader2 className="h-5 w-5 animate-spin text-surface-on-variant" aria-hidden />
          <p className="text-sm text-surface-on-variant">Loading map</p>
        </div>
      )}
    </div>
  )
}
