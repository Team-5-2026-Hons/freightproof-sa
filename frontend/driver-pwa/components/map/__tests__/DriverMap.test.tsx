// frontend/driver-pwa/components/map/__tests__/DriverMap.test.tsx
//
// One rule, tested at every rung: the map must NEVER render a plausible-looking wrong
// position. Each degradation step therefore has to be visibly, verbally different — a
// missing key, a dead zone and a missing fix are three different sentences to a driver,
// and none of them may be a silent grey pane.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DriverMap } from '../DriverMap'
import type { DriverPosition } from '@/lib/types/location'

// Mutable through a getter: DriverMap reads GOOGLE_MAPS_API_KEY as a module binding, and
// the "key absent" and "key present" ladders are two different code paths in one suite.
let mockApiKey = ''
vi.mock('@/lib/constants/env', () => ({
  get GOOGLE_MAPS_API_KEY() { return mockApiKey },
  IS_DEMO_MODE: true,
}))

let mockPlatform = 'web'
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mockPlatform,
    isNativePlatform: () => mockPlatform !== 'web',
  },
}))

const mockImportLibrary = vi.fn()
const mockSetOptions = vi.fn()
vi.mock('@googlemaps/js-api-loader', () => ({
  importLibrary: (name: string) => mockImportLibrary(name),
  setOptions: (opts: unknown) => mockSetOptions(opts),
}))

interface FakeCircleOptions {
  center: { lat: number; lng: number }
  radius: number
}

// Minimal stand-ins for the two Maps JS classes DriverMap constructs. They record the
// arguments the component passes so the "centred on the phone's own fix" and "follows the
// driver" behaviours can be asserted without a real Google Maps runtime.
const mapCtor = vi.fn()
const circleCtor = vi.fn()
const setCenter = vi.fn()
const setRadius = vi.fn()

class FakeMap {
  constructor(container: HTMLElement, options: { center: { lat: number; lng: number } }) {
    mapCtor(container, options)
  }
  setCenter = setCenter
}

class FakeCircle {
  constructor(options: FakeCircleOptions) {
    circleCtor(options)
  }
  setCenter = vi.fn()
  setRadius = setRadius
  setMap = vi.fn()
}

const JHB_FIX: DriverPosition = { lat: -26.09421, lng: 28.13422, accuracyM: 12 }
const FIX_TAKEN_AT = '2026-08-05T09:30:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  mockApiKey = ''
  mockPlatform = 'web'
  mockImportLibrary.mockResolvedValue({ Map: FakeMap, Circle: FakeCircle })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DriverMap rung 3 — no GPS fix at all', () => {
  it('says the position is unavailable and draws nothing', () => {
    mockApiKey = 'a-real-key'

    render(<DriverMap position={null} capturedAt={null} />)

    expect(screen.getByText('Position unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /map/i })).not.toBeInTheDocument()
    expect(mockImportLibrary).not.toHaveBeenCalled()
  })

  it('offers a retry that asks the caller for a fresh fix', () => {
    const onRetry = vi.fn()

    render(<DriverMap position={null} capturedAt={null} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders no retry control when the caller supplies none', () => {
    render(<DriverMap position={null} capturedAt={null} />)

    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })
})

describe('DriverMap rung 1 — no API key configured', () => {
  it('shows the coordinates card instead of loading any map', () => {
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.getByText('Map not available on this build')).toBeInTheDocument()
    expect(screen.getByText('-26.09421, 28.13422')).toBeInTheDocument()
    expect(screen.getByText(/Accurate to about 12 m/)).toBeInTheDocument()
    expect(mockImportLibrary).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /map/i })).not.toBeInTheDocument()
  })

  it('hands off to the browser map on web', () => {
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.getByRole('link', { name: /open in maps/i })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=-26.09421%2C28.13422',
    )
  })

  it('hands off to the native map app with a geo: intent on Android', () => {
    mockPlatform = 'android'

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.getByRole('link', { name: /open in maps/i })).toHaveAttribute(
      'href',
      'geo:-26.09421,28.13422?q=-26.09421%2C28.13422',
    )
  })

  it('states honestly when the device reports no accuracy figure', () => {
    render(<DriverMap position={{ ...JHB_FIX, accuracyM: null }} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.getByText(/Accuracy not reported by this device/)).toBeInTheDocument()
  })
})

describe('DriverMap fix labelling', () => {
  it('labels a fresh fix as the current position', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIX_TAKEN_AT))

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.getByText('Current position')).toBeInTheDocument()
  })

  it('labels a fix older than the staleness window as LAST KNOWN, never as current', () => {
    vi.useFakeTimers()
    // Ten minutes after the fix was taken: the truck has moved and the card must say so.
    vi.setSystemTime(new Date('2026-08-05T09:40:00.000Z'))

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.getByText('Last known position')).toBeInTheDocument()
    expect(screen.queryByText('Current position')).not.toBeInTheDocument()
  })

  it('treats an unknown capture time as stale rather than current', () => {
    render(<DriverMap position={JHB_FIX} capturedAt={null} />)

    expect(screen.getByText('Last known position')).toBeInTheDocument()
  })
})

describe('DriverMap rung 2 — key present, tiles unreachable', () => {
  it('falls back to the coordinates card with an offline explanation', async () => {
    mockApiKey = 'a-real-key'
    mockImportLibrary.mockRejectedValue(new Error('Failed to fetch the Maps JS API'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(await screen.findByText('Map unavailable offline')).toBeInTheDocument()
    expect(screen.getByText('-26.09421, 28.13422')).toBeInTheDocument()
    // Never swallowed — a failure the driver sees is also a failure the logs record.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('retries the load when the phone comes back online', async () => {
    mockApiKey = 'a-real-key'
    mockImportLibrary.mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)
    expect(await screen.findByText('Map unavailable offline')).toBeInTheDocument()

    // A dead zone clears; the driver should get their map back without leaving the screen.
    mockImportLibrary.mockResolvedValue({ Map: FakeMap, Circle: FakeCircle })
    fireEvent(window, new Event('online'))

    expect(await screen.findByRole('region', { name: /map/i })).toBeInTheDocument()
    warn.mockRestore()
  })
})

describe('DriverMap with a working key', () => {
  it('centres the map on the phone’s own fix, at street zoom', async () => {
    mockApiKey = 'a-real-key'

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    await waitFor(() => expect(mapCtor).toHaveBeenCalled())
    const [, options] = mapCtor.mock.calls[0] as [HTMLElement, { center: { lat: number; lng: number }; zoom: number }]
    expect(options.center).toEqual({ lat: JHB_FIX.lat, lng: JHB_FIX.lng })
    expect(options.zoom).toBeGreaterThan(0)
    expect(screen.queryByText(/Map unavailable/)).not.toBeInTheDocument()
  })

  it('draws the accuracy halo at the fix’s own reported accuracy', async () => {
    mockApiKey = 'a-real-key'

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    await waitFor(() => expect(circleCtor).toHaveBeenCalledTimes(2))
    const radii = circleCtor.mock.calls.map(([opts]) => (opts as FakeCircleOptions).radius)
    expect(radii).toContain(JHB_FIX.accuracyM)
  })

  it('follows the driver — a new fix re-centres the map', async () => {
    mockApiKey = 'a-real-key'
    const { rerender } = render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)
    await waitFor(() => expect(mapCtor).toHaveBeenCalled())

    const moved: DriverPosition = { lat: -26.2041, lng: 28.0473, accuracyM: 9 }
    rerender(<DriverMap position={moved} capturedAt="2026-08-05T09:31:00.000Z" />)

    await waitFor(() => expect(setCenter).toHaveBeenCalledWith({ lat: moved.lat, lng: moved.lng }))
    expect(setRadius).toHaveBeenCalledWith(moved.accuracyM)
  })
})
