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
import { MAP_STYLES_QUIET } from '@/lib/tokens'


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
const mapSetOptions = vi.fn()

class FakeMap {
  constructor(container: HTMLElement, options: { center: { lat: number; lng: number } }) {
    mapCtor(container, options)
  }
  setCenter = setCenter
  setOptions = mapSetOptions
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
  document.documentElement.classList.remove('dark')
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

describe('DriverMap — theme and handoff', () => {
  it('draws the dark basemap when the app is in the dark theme', async () => {
    // Arrange
    mockApiKey = 'a-real-key'
    document.documentElement.classList.add('dark')

    // Act
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    // Assert
    await waitFor(() => expect(mapCtor).toHaveBeenCalled())
    const [, options] = mapCtor.mock.calls[0] as [HTMLElement, { styles: unknown[] | null }]
    expect(Array.isArray(options.styles)).toBe(true)
    expect(options.styles!.length).toBeGreaterThan(0)
  })

  it('keeps Google’s light palette but hides points of interest in the light theme', async () => {
    // Arrange
    mockApiKey = 'a-real-key'

    // Act
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    // Assert
    await waitFor(() => expect(mapCtor).toHaveBeenCalled())
    const [, options] = mapCtor.mock.calls[0] as [HTMLElement, { styles: unknown[] | null }]
    expect(options.styles).toEqual(MAP_STYLES_QUIET)
  })

  it('restyles a live map when the theme flips (e.g. the automatic switch at sunset)', async () => {
    // Arrange
    mockApiKey = 'a-real-key'
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)
    await screen.findByRole('link', { name: /open in maps/i })

    // Act
    document.documentElement.classList.add('dark')

    // Assert
    await waitFor(() => expect(mapSetOptions).toHaveBeenCalledWith({ styles: expect.any(Array) }))
  })

  it('offers the phone’s map app from the live map, not only from the fallback cards', async () => {
    // Arrange
    mockApiKey = 'a-real-key'

    // Act
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    // Assert
    const link = await screen.findByRole('link', { name: /open in maps/i })
    expect(link).toHaveAttribute('href', expect.stringContaining(String(JHB_FIX.lat)))
  })

  it('sizes the fallback cards separately from the map strip', () => {
    // Arrange — no fix, so the no-fix panel renders instead of a map.

    // Act
    const { container } = render(
      <DriverMap position={null} capturedAt={null} className="h-[200px]" fallbackClassName="w-full" />,
    )

    // Assert — the fixed strip height would clip the panel's text and Retry button.
    expect(container.firstElementChild).not.toHaveClass('h-[200px]')
    expect(container.firstElementChild).toHaveClass('w-full')
  })
})

describe('DriverMap extra action', () => {
  const navigate = <a href="https://maps.example/dir">Navigate</a>

  // Regression: the caller used to float its own Navigate chip over the map slot, which on a
  // 360x740 phone sat on top of the card's full-width "Open in Maps" button. On a fallback
  // card the action has to join the card's flow, after the hand-off button, so the two can
  // never overlap whatever the card's text does.
  it('test_sets_the_action_in_the_coordinates_card_flow_after_open_in_maps', () => {
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} extraAction={navigate} extraActionClassName="bottom-12 right-4" />)

    const openInMaps = screen.getByRole('link', { name: /open in maps/i })
    const action = screen.getByRole('link', { name: 'Navigate' })
    expect(openInMaps.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // In the flow, not floated: no absolute ancestor between the action and the card.
    expect(action.closest('.absolute')).toBeNull()
  })

  it('test_keeps_the_action_available_when_there_is_no_fix', () => {
    render(<DriverMap position={null} capturedAt={null} extraAction={navigate} />)

    expect(screen.getByRole('link', { name: 'Navigate' })).toBeInTheDocument()
  })

  it('test_floats_the_action_over_a_live_map_where_the_caller_places_it', async () => {
    mockApiKey = 'a-real-key'

    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} extraAction={navigate} extraActionClassName="bottom-12 right-4" />)

    await screen.findByRole('link', { name: /open in maps/i })
    const floated = screen.getByRole('link', { name: 'Navigate' }).parentElement
    expect(floated).toHaveClass('absolute', 'bottom-12', 'right-4')
  })

  it('test_renders_nothing_extra_when_no_action_is_given', () => {
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    expect(screen.queryByRole('link', { name: 'Navigate' })).not.toBeInTheDocument()
  })
})

describe('DriverMap planned route line', () => {
  const polylineCtor = vi.fn()
  const polylineSetMap = vi.fn()

  class FakePolyline {
    constructor(options: { path: Array<{ lat: number; lng: number }>; zIndex: number }) {
      polylineCtor(options)
    }
    setMap = polylineSetMap
  }

  const LEG: Array<[number, number]> = [[-26.09, 28.13], [-26.2, 28.2], [-26.3, 28.3]]

  beforeEach(() => {
    polylineCtor.mockClear()
    polylineSetMap.mockClear()
    mockApiKey = 'a-real-key'
    mockImportLibrary.mockResolvedValue({ Map: FakeMap, Circle: FakeCircle, Polyline: FakePolyline })
  })

  it('draws the leg lat-first into the Maps {lat, lng} shape, under the driver dot', async () => {
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} route={LEG} />)

    await waitFor(() => expect(polylineCtor).toHaveBeenCalledOnce())
    const options = polylineCtor.mock.calls[0][0]
    expect(options.path).toEqual([
      { lat: -26.09, lng: 28.13 }, { lat: -26.2, lng: 28.2 }, { lat: -26.3, lng: 28.3 },
    ])
    const dotOptions = circleCtor.mock.calls.at(-1)?.[0] as { zIndex: number }
    expect(options.zIndex).toBeLessThan(dotOptions.zIndex)
  })

  it('draws no line without a route', async () => {
    render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} />)

    await screen.findByRole('region', { name: /map/i })
    await waitFor(() => expect(mapCtor).toHaveBeenCalled())
    expect(polylineCtor).not.toHaveBeenCalled()
  })

  it('replaces the line when the leg changes and removes it on unmount', async () => {
    const { rerender, unmount } = render(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} route={LEG} />)
    await waitFor(() => expect(polylineCtor).toHaveBeenCalledOnce())

    rerender(<DriverMap position={JHB_FIX} capturedAt={FIX_TAKEN_AT} route={LEG.slice(1)} />)
    await waitFor(() => expect(polylineCtor).toHaveBeenCalledTimes(2))
    expect(polylineSetMap).toHaveBeenCalledWith(null)

    polylineSetMap.mockClear()
    unmount()
    expect(polylineSetMap).toHaveBeenCalledWith(null)
  })
})
