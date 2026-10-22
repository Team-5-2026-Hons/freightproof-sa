import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSimulatedPosition,
  isSimulationAvailable,
  parseCoordinatePair,
  readSimulatedPosition,
  simulatedCapture,
  writeSimulatedPosition,
} from '../simulated-position'

const STORAGE_KEY = 'fp.demo.simulated-position'
const DEMO_COORDS = { lat: -33.918861, lng: 18.4233, accuracyM: 8, driftM: 0 }

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllEnvs()
})

describe('with NEXT_PUBLIC_DEMO_GPS unset', () => {
  it('reports simulation unavailable and refuses to store an override', () => {
    expect(isSimulationAvailable()).toBe(false)
    expect(writeSimulatedPosition(DEMO_COORDS)).toBe(false)
    expect(readSimulatedPosition()).toBeNull()
    expect(simulatedCapture()).toBeNull()
  })

  it('ignores an override planted directly in storage', () => {
    // The flag, not the absence of stored state, is what makes a normal build safe:
    // storage is writable by anything running in the page.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_COORDS))

    expect(readSimulatedPosition()).toBeNull()
    expect(simulatedCapture()).toBeNull()
  })
})

describe('with NEXT_PUBLIC_DEMO_GPS=true', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_GPS', 'true')
  })

  it('is off until an override is written', () => {
    expect(isSimulationAvailable()).toBe(true)
    expect(readSimulatedPosition()).toBeNull()
    expect(simulatedCapture()).toBeNull()
  })

  it('returns the exact coordinate when drift is zero', () => {
    writeSimulatedPosition(DEMO_COORDS)

    const capture = simulatedCapture()

    expect(capture?.latitude).toBe(DEMO_COORDS.lat)
    expect(capture?.longitude).toBe(DEMO_COORDS.lng)
    expect(capture?.accuracy).toBe(DEMO_COORDS.accuracyM)
    expect(Number.isNaN(Date.parse(capture?.capturedAt ?? ''))).toBe(false)
  })

  it('moves each capture within the drift radius', () => {
    const driftM = 50
    writeSimulatedPosition({ ...DEMO_COORDS, driftM })

    const first = simulatedCapture()
    const second = simulatedCapture()

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    // Within ~2x the drift in degrees of latitude; the point is bounded movement, not a
    // frozen pin, so assert the envelope rather than an exact offset.
    const maxDegrees = (driftM * 2) / 111_320
    expect(Math.abs((first?.latitude ?? 0) - DEMO_COORDS.lat)).toBeLessThan(maxDegrees)
    expect(Math.abs((second?.latitude ?? 0) - DEMO_COORDS.lat)).toBeLessThan(maxDegrees)
  })

  it('clears back to the real device', () => {
    writeSimulatedPosition(DEMO_COORDS)
    clearSimulatedPosition()

    expect(readSimulatedPosition()).toBeNull()
    expect(simulatedCapture()).toBeNull()
  })

  it('treats corrupt or out-of-range stored state as no override', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json')
    expect(readSimulatedPosition()).toBeNull()

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lat: 900, lng: 18 }))
    expect(readSimulatedPosition()).toBeNull()
  })

  it('parses a pasted coordinate pair, and rejects anything else', () => {
    expect(parseCoordinatePair('-33.918861, 18.423300')).toEqual({ lat: -33.918861, lng: 18.4233 })
    expect(parseCoordinatePair('-33.918861 18.423300')).toEqual({ lat: -33.918861, lng: 18.4233 })
    expect(parseCoordinatePair('-33.918861')).toBeNull()
    expect(parseCoordinatePair('here, there')).toBeNull()
    expect(parseCoordinatePair('91, 18')).toBeNull()
    expect(parseCoordinatePair('')).toBeNull()
  })
})
