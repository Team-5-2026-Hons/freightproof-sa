'use client'

import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  SIMULATED_POSITION_EVENT,
  isSimulationAvailable,
  readSimulatedPosition,
  type SimulatedPosition,
} from '@/lib/location/simulated-position'

// Fixed decimals so the readout is the same width every render and cannot be mistaken
// for a live-varying device fix. Six places is ~0.1m — more than the drift needs.
const COORDINATE_DECIMALS = 6

/**
 * Permanent warning shown while the phone's position is being simulated.
 *
 * Not dismissible, and deliberately loud: a simulated fix is written into evidence
 * fields with nothing in the ledger marking it as simulated (see
 * lib/location/simulated-position.ts), so the screen is the only place that says so.
 * Renders nothing — not even a wrapper — in any build without NEXT_PUBLIC_DEMO_GPS.
 */
export function SimulatedGpsBanner() {
  const [position, setPosition] = useState<SimulatedPosition | null>(null)

  useEffect(() => {
    if (!isSimulationAvailable()) return
    // Read on mount rather than during render: localStorage is unavailable during the
    // static-export prerender, and a first paint that disagreed with it would flash.
    const sync = () => setPosition(readSimulatedPosition())
    sync()
    window.addEventListener(SIMULATED_POSITION_EVENT, sync)
    // Another tab (browser PWA) switching it off must clear this one's banner too.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SIMULATED_POSITION_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (position === null) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-error px-4 py-1.5 text-center text-error-on"
    >
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
      <p className="text-footnote font-semibold">
        Simulated GPS —{' '}
        <span className="tabular-nums font-normal">
          {position.lat.toFixed(COORDINATE_DECIMALS)}, {position.lng.toFixed(COORDINATE_DECIMALS)}
        </span>
      </p>
    </div>
  )
}
