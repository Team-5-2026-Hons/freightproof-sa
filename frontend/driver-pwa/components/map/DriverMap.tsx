'use client'

// Evidence, not operations: shows a position and, when given one, the planned route line.
// It never routes or navigates — the line is drawn from data the caller already holds.
//
// Core rule: must never render a plausible-looking wrong position. Every failure degrades
// to something explicitly labelled instead:
//   1. No API key configured        -> coordinates card + "Open in Maps" handoff.
//   2. Key present, tiles unreachable -> same card, with the fix's own timestamp.
//   3. No GPS fix at all             -> honest "position unavailable" panel.
//
// POPIA: never transmits a coordinate; draws locally what the caller passes in.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { Loader2, MapPinOff, Navigation, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GOOGLE_MAPS_API_KEY } from '@/lib/constants/env'
import { DARK_CLASS } from '@/lib/theme'
import { MAP_STYLES_DARK, MAP_STYLES_QUIET } from '@/lib/tokens'
import { formatTime } from '@/lib/utils/format-time'
import { Button } from '@/components/ui/Button'
import type { DriverPosition } from '@/lib/types/location'
import type { RouteCoordinate } from '@/lib/types/route'

const MAP_ZOOM = 15

const DRIVER_DOT_RADIUS_M = 12

const FALLBACK_ACCURACY_RADIUS_M = 50

const ACCURACY_FILL_OPACITY = 0.15

const ROUTE_STROKE_WEIGHT = 5
const ROUTE_STROKE_OPACITY = 0.55
const ROUTE_Z_INDEX = 0
const DRIVER_Z_INDEX = 1
const ACCURACY_STROKE_OPACITY = 0.4

const COORDINATE_DECIMALS = 5

const STALE_FIX_MS = 60_000

const DRIVER_COLOUR_VAR = '--fp-secondary'
const DRIVER_COLOUR_FALLBACK = 'rgb(0 81 213)'

function tokenColour(variable: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return raw === '' ? fallback : `rgb(${raw})`
}

let mapsOptionsApplied = false

function applyMapsOptions(apiKey: string): void {
  if (mapsOptionsApplied) return
  setOptions({ key: apiKey })
  mapsOptionsApplied = true
}

/** Deep link handing the position to the phone's own map app: a handoff, not navigation. */
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

function themedMapStyles(): google.maps.MapTypeStyle[] | null {
  if (typeof document === 'undefined') return null
  return document.documentElement.classList.contains(DARK_CLASS)
    ? [...MAP_STYLES_DARK, ...MAP_STYLES_QUIET]
    : MAP_STYLES_QUIET
}

function formatCoordinate(value: number): string {
  return value.toFixed(COORDINATE_DECIMALS)
}

function isStale(capturedAt: string | null, now: number): boolean {
  if (capturedAt === null) return true
  const takenAt = new Date(capturedAt).getTime()
  if (Number.isNaN(takenAt)) return true
  return now - takenAt > STALE_FIX_MS
}

function FallbackExtraAction({ children }: { children: ReactNode }) {
  return <div className="flex w-full shrink-0 justify-end">{children}</div>
}

/** Why the map itself is not on screen. Drives the coordinates card's headline copy. */
type FallbackReason = 'no-key' | 'tiles-unreachable'

interface CoordinatesCardProps {
  position: DriverPosition
  capturedAt: string | null
  reason: FallbackReason
  className?: string
  extraAction?: ReactNode
}

function CoordinatesCard({ position, capturedAt, reason, className, extraAction }: CoordinatesCardProps) {
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
        <p className="text-footnote font-semibold text-surface-on-variant">
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

      <a
        href={nativeMapsUrl(position)}
        rel="noopener noreferrer"
        className={cn(
          'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-6 py-4',
          'text-body font-semibold transition-all duration-200 active:scale-[0.98]',
          'border border-outline-variant/60 bg-surface-container-lowest text-surface-on',
          'hover:bg-surface-container-low',
        )}
      >
        <Navigation className="h-4 w-4" strokeWidth={2} aria-hidden />
        Open in Maps
      </a>
      {extraAction !== undefined && <FallbackExtraAction>{extraAction}</FallbackExtraAction>}
    </div>
  )
}

interface NoFixPanelProps {
  onRetry?: () => void
  className?: string
  extraAction?: ReactNode
}

function NoFixPanel({ onRetry, className, extraAction }: NoFixPanelProps) {
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
          Try Again
        </Button>
      )}
      {extraAction !== undefined && <FallbackExtraAction>{extraAction}</FallbackExtraAction>}
    </div>
  )
}

export interface DriverMapProps {
  position: DriverPosition | null
  capturedAt: string | null
  /** Re-request a fix. Omit to render the no-fix state without a retry control. */
  onRetry?: () => void
  className?: string
  handoffClassName?: string
  fallbackClassName?: string
  extraAction?: ReactNode
  extraActionClassName?: string
  route?: readonly RouteCoordinate[] | null
}

/** Whether the Maps JS API is usable right now. */
type MapState = 'loading' | 'ready' | 'unavailable'

export function DriverMap({ position, capturedAt, onRetry, className, handoffClassName, fallbackClassName = className, extraAction, extraActionClassName, route = null }: DriverMapProps) {
  const [mapState, setMapState] = useState<MapState>('loading')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const driverDotRef = useRef<google.maps.Circle | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)
  const routeLineRef = useRef<google.maps.Polyline | null>(null)
  const mapsLibraryRef = useRef<google.maps.MapsLibrary | null>(null)

  const hasKey = GOOGLE_MAPS_API_KEY !== ''

  useEffect(() => {
    if (!hasKey || position === null || mapState !== 'loading' || mapRef.current !== null) return

    const container = containerRef.current
    if (container === null) return

    let cancelled = false
    const centre = { lat: position.lat, lng: position.lng }
    const driverColour = tokenColour(DRIVER_COLOUR_VAR, DRIVER_COLOUR_FALLBACK)

    applyMapsOptions(GOOGLE_MAPS_API_KEY)
    importLibrary('maps')
      .then((library) => {
        if (cancelled) return
        const { Map, Circle } = library
        mapsLibraryRef.current = library

        const map = new Map(container, {
          center: centre,
          zoom: MAP_ZOOM,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: false,
          styles: themedMapStyles(),
        })

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
          zIndex: DRIVER_Z_INDEX,
        })

        mapRef.current = map
        setMapState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[DriverMap] Google Maps JS API could not be loaded', err)
        setMapState('unavailable')
      })

    return () => { cancelled = true }
  }, [hasKey, position, mapState])

  useEffect(() => {
    const map = mapRef.current
    if (map === null || position === null) return

    const centre = { lat: position.lat, lng: position.lng }
    map.setCenter(centre)
    driverDotRef.current?.setCenter(centre)
    accuracyRef.current?.setCenter(centre)
    accuracyRef.current?.setRadius(position.accuracyM ?? FALLBACK_ACCURACY_RADIUS_M)
  }, [position, mapState])

  useEffect(() => {
    const map = mapRef.current
    const Polyline = mapsLibraryRef.current?.Polyline
    routeLineRef.current?.setMap(null)
    routeLineRef.current = null
    if (mapState !== 'ready' || map === null || Polyline === undefined || route === null || route.length < 2) return

    routeLineRef.current = new Polyline({
      map,
      path: route.map(([lat, lng]) => ({ lat, lng })),
      strokeColor: tokenColour(DRIVER_COLOUR_VAR, DRIVER_COLOUR_FALLBACK),
      strokeOpacity: ROUTE_STROKE_OPACITY,
      strokeWeight: ROUTE_STROKE_WEIGHT,
      clickable: false,
      zIndex: ROUTE_Z_INDEX,
    })
  }, [route, mapState])

  useEffect(() => {
    if (mapState !== 'ready' || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      mapRef.current?.setOptions({ styles: themedMapStyles() })
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [mapState])

  useEffect(() => () => {
    driverDotRef.current?.setMap(null)
    accuracyRef.current?.setMap(null)
    routeLineRef.current?.setMap(null)
    driverDotRef.current = null
    accuracyRef.current = null
    routeLineRef.current = null
    mapsLibraryRef.current = null
    mapRef.current = null
  }, [])

  const retryTiles = useCallback(() => {
    if (mapRef.current !== null) return
    setMapState('loading')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('online', retryTiles)
    return () => window.removeEventListener('online', retryTiles)
  }, [retryTiles])

  if (position === null) return <NoFixPanel onRetry={onRetry} className={fallbackClassName} extraAction={extraAction} />
  if (!hasKey) return <CoordinatesCard position={position} capturedAt={capturedAt} reason="no-key" className={fallbackClassName} extraAction={extraAction} />
  if (mapState === 'unavailable') {
    return <CoordinatesCard position={position} capturedAt={capturedAt} reason="tiles-unreachable" className={fallbackClassName} extraAction={extraAction} />
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
      {mapState === 'ready' && (
        <a
          href={nativeMapsUrl(position)}
          rel="noopener noreferrer"
          className={cn(
            'glass-nav absolute left-2 top-2 flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-footnote font-semibold text-surface-on shadow-level-2 transition-opacity duration-100 active:opacity-60',
            handoffClassName,
          )}
        >
          <Navigation className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          Open in Maps
        </a>
      )}
      {extraAction !== undefined && <div className={cn('absolute', extraActionClassName)}>{extraAction}</div>}
    </div>
  )
}
