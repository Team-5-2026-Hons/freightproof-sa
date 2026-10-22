'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ListSection } from '@/components/ui/ListSection'
import { useLocation } from '@/lib/hooks/useLocation'
import {
  DEFAULT_ACCURACY_METRES,
  DEFAULT_DRIFT_METRES,
  SIMULATED_POSITION_EVENT,
  clearSimulatedPosition,
  isSimulationAvailable,
  parseCoordinatePair,
  readSimulatedPosition,
  writeSimulatedPosition,
} from '@/lib/location/simulated-position'

// Same precision the banner prints, so what is typed, stored and shown all agree.
const COORDINATE_DECIMALS = 6

/**
 * Presenter control for the demo phone-position override.
 *
 * No built-in list of depot coordinates: the backend's DEMO_WAYPOINTS
 * (app/dev/endpoints/pulsit.py) is the one definition of the demo route, and that
 * endpoint needs a dispatcher token this app will never hold. Copying the list here
 * would give a corrected digit somewhere to hide, so the coordinate is pasted from the
 * dispatcher panel that staged the truck instead — the two sides then provably match.
 *
 * Renders nothing unless NEXT_PUBLIC_DEMO_GPS was set in the build.
 */
export function SimulatedGpsPanel() {
  const [active, setActive] = useState(false)
  const [input, setInput] = useState('')
  const [drift, setDrift] = useState(String(DEFAULT_DRIFT_METRES))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { captureResult } = useLocation()

  const sync = useCallback(() => {
    const stored = readSimulatedPosition()
    setActive(stored !== null)
    if (stored !== null) {
      setInput(`${stored.lat.toFixed(COORDINATE_DECIMALS)}, ${stored.lng.toFixed(COORDINATE_DECIMALS)}`)
      setDrift(String(stored.driftM))
    }
  }, [])

  useEffect(() => {
    if (!isSimulationAvailable()) return
    sync()
    window.addEventListener(SIMULATED_POSITION_EVENT, sync)
    return () => window.removeEventListener(SIMULATED_POSITION_EVENT, sync)
  }, [sync])

  if (!isSimulationAvailable()) return null

  function apply(): void {
    const pair = parseCoordinatePair(input)
    if (pair === null) {
      setError('Needs two numbers: latitude, longitude')
      return
    }
    const driftM = Number(drift)
    if (!Number.isFinite(driftM) || driftM < 0) {
      setError('Drift must be 0 or more metres')
      return
    }
    setError(null)
    const stored = writeSimulatedPosition({
      lat: pair.lat, lng: pair.lng, accuracyM: DEFAULT_ACCURACY_METRES, driftM,
    })
    if (!stored) setError('This phone would not store the override')
  }

  function stop(): void {
    setError(null)
    clearSimulatedPosition()
  }

  // Seeds the field from a REAL fix, so a presenter can start from where they actually
  // are and nudge it, rather than typing a coordinate from nothing.
  async function useRealFix(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const { coords, errorReason } = await captureResult()
      if (coords === null) {
        setError(`Could not read this phone's position (${errorReason ?? 'unknown'})`)
        return
      }
      setInput(`${coords.latitude.toFixed(COORDINATE_DECIMALS)}, ${coords.longitude.toFixed(COORDINATE_DECIMALS)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ListSection title="Demo GPS" inset="text" className="mt-5">
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-footnote text-surface-on-variant">
          Overrides every position this phone records. Evidence will not show that it was
          simulated — use only for a demo.
        </p>

        <label htmlFor="demo-gps-coords" className="text-footnote font-semibold text-surface-on">
          Latitude, longitude
        </label>
        <input
          id="demo-gps-coords"
          value={input}
          onChange={event => setInput(event.target.value)}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="-33.918861, 18.423300"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body tabular-nums text-surface-on"
        />

        <label htmlFor="demo-gps-drift" className="text-footnote font-semibold text-surface-on">
          Drift per capture (metres)
        </label>
        <input
          id="demo-gps-drift"
          value={drift}
          onChange={event => setDrift(event.target.value)}
          inputMode="numeric"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body tabular-nums text-surface-on"
        />

        {error !== null && <p role="alert" className="text-footnote font-semibold text-error">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={apply}>
            {active ? 'Update' : 'Start simulating'}
          </Button>
          <Button variant="secondary" size="sm" onClick={useRealFix} disabled={busy}>
            {busy ? 'Reading…' : 'Use real fix'}
          </Button>
          {active && (
            <Button variant="secondary" size="sm" onClick={stop}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </ListSection>
  )
}
