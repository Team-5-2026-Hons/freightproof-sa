import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimeline } from '@/lib/timeline'
import { makeCheckpoint, makeException, makeManifest, makePhase, makeStop } from '@/test/factories'
import type { PositionFix } from '@/lib/types'
import RouteMap, { textTooltip } from './RouteMap'

const XSS = '<img src=x onerror="window.__pwned = true">'

const fix = (lat: number, lng: number, overrides: Partial<PositionFix> = {}): PositionFix => ({
  lat, lng, source: 'driver_phone', recorded_at: '2026-09-12T10:00:00Z', accuracy_metres: null, ...overrides,
})

function mapWith(manifest = makeManifest()) {
  return { manifest, items: buildTimeline(manifest) }
}

/** matchMedia that reports a match only for the queries listed. */
function stubMatchMedia(matching: string[]) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.some((fragment) => query.includes(fragment)), media: query, addEventListener: () => undefined,
    removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined,
    onchange: null, dispatchEvent: () => false,
  }))
}

// jsdom has no canvas, and the map draws on one (preferCanvas). Every method is a no-op: these
// tests are about which layers get built and how, not about pixels.
// Installed for the whole file rather than spied per test: Leaflet redraws on animation frames that
// can fire after a test has finished, and they still need a context to draw on.
const canvasContext = new Proxy({}, { get: () => () => undefined, set: () => true })
HTMLCanvasElement.prototype.getContext = (() => canvasContext) as unknown as HTMLCanvasElement['getContext']

beforeEach(() => {
  delete (window as unknown as { __pwned?: boolean }).__pwned
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('textTooltip', () => {
  it('returns an element whose text is the input, with no parsed markup inside', () => {
    // Act
    const node = textTooltip(XSS)

    // Assert
    expect(node).toBeInstanceOf(HTMLElement)
    expect(node.textContent).toBe(XSS)
    expect(node.children).toHaveLength(0)
    expect(node.querySelector('img')).toBeNull()
  })

  it('keeps ordinary text as it is', () => {
    expect(textTooltip('1. Harrismith depot').textContent).toBe('1. Harrismith depot')
  })

  it('makes Leaflet show markup as text, where a string would have been parsed into elements', () => {
    // Arrange
    const holder = document.createElement('div')
    document.body.appendChild(holder)
    const map = L.map(holder).setView([0, 0], 2)

    // Act
    const safe = L.tooltip({ permanent: true }).setLatLng([0, 0]).setContent(textTooltip('<b>x</b>')).addTo(map)
    const unsafe = L.tooltip({ permanent: true }).setLatLng([1, 1]).setContent('<b>y</b>').addTo(map)

    // Assert: the string path is the sink this helper exists to avoid.
    const safeElement = safe.getElement() as HTMLElement
    const unsafeElement = unsafe.getElement() as HTMLElement
    expect(safeElement.querySelector('b')).toBeNull()
    expect(safeElement.textContent).toBe('<b>x</b>')
    expect(unsafeElement.querySelector('b')).not.toBeNull()

    map.remove()
    holder.remove()
  })
})

describe('RouteMap — operator-typed names never become markup', () => {
  it('shows a hostile precinct name as text in its permanent label', () => {
    // Arrange
    const manifest = makeManifest({ stops: [makeStop(1, { precinct_name: XSS })] })

    // Act
    const { container } = render(<RouteMap {...mapWith(manifest)} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    const tooltip = container.querySelector('.leaflet-tooltip')
    expect(tooltip).not.toBeNull()
    expect(tooltip!.textContent).toBe(`1. ${XSS}`)
    expect(tooltip!.querySelector('img')).toBeNull()
    expect(tooltip!.children).toHaveLength(1) // just the span textTooltip made
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('passes no string to bindTooltip anywhere', () => {
    // Arrange
    const bind = vi.spyOn(L.Layer.prototype, 'bindTooltip')
    const manifest = makeManifest({
      stops: [makeStop(1, { precinct_name: XSS })],
      location_trail: [fix(-26.2, 28.0), fix(-26.3, 28.1, { recorded_at: '2026-09-12T12:00:00Z' }), fix(-26.25, 28.05, { source: 'vehicle_tracker' })],
      location_coverage: {
        ...makeManifest().location_coverage,
        gaps: [{ start: '2026-09-12T10:30:00Z', end: '2026-09-12T11:30:00Z', minutes: 60 }],
      },
      checkpoints: [makeCheckpoint({ driver_phone: fix(-26.2, 28.0) })],
      exceptions: [makeException('panic_button', 'critical', { position: fix(-26.2, 28.0) })],
    })

    // Act
    render(<RouteMap {...mapWith(manifest)} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(bind.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const [content] of bind.mock.calls) expect(typeof content).not.toBe('string')
  })
})

describe('RouteMap — geofences', () => {
  it('draws the outline when a stop has one, and the radius circle when it does not', () => {
    // Arrange
    const polygon = vi.spyOn(L, 'polygon')
    const circle = vi.spyOn(L, 'circle')
    const outline: [number, number][] = [[-26.2, 28.0], [-26.2, 28.01], [-26.21, 28.01]]
    const manifest = makeManifest({ stops: [makeStop(1, { geofence_polygon: outline }), makeStop(2), makeStop(3, { geofence_polygon: null })] })

    // Act
    render(<RouteMap {...mapWith(manifest)} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(polygon).toHaveBeenCalledTimes(1)
    expect(polygon.mock.calls[0][0]).toEqual(outline)
    expect(circle).toHaveBeenCalledTimes(2)
  })

  it('falls back to the circle for an outline too short to be a shape or with broken corners', () => {
    // Arrange
    const polygon = vi.spyOn(L, 'polygon')
    const circle = vi.spyOn(L, 'circle')
    const broken = [[-26.2, 28.0], [Number.NaN, 28.01], [-26.21, 28.01]] as [number, number][]
    const manifest = makeManifest({ stops: [makeStop(1, { geofence_polygon: broken }), makeStop(2, { geofence_polygon: [[-26.2, 28.0]] })] })

    // Act
    render(<RouteMap {...mapWith(manifest)} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(polygon).not.toHaveBeenCalled()
    expect(circle).toHaveBeenCalledTimes(2)
  })
})

describe('RouteMap — an empty pack', () => {
  it('says so over the map and falls back to South Africa', () => {
    // Arrange
    const setView = vi.spyOn(L.Map.prototype, 'setView')

    // Act
    render(<RouteMap {...mapWith()} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(screen.getByText('No positions recorded in this pack')).toBeInTheDocument()
    expect(setView).toHaveBeenCalledWith([-28.5, 26.5], 5)
  })

  it('does not show that message when the pack has positions', () => {
    // Act
    render(<RouteMap {...mapWith(makeManifest({ stops: [makeStop(1)] }))} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(screen.queryByText('No positions recorded in this pack')).not.toBeInTheDocument()
  })
})

describe('RouteMap — map options', () => {
  it('uses the canvas renderer and keeps the strict-origin referrer policy on tiles', () => {
    // Arrange
    const map = vi.spyOn(L, 'map')
    const tiles = vi.spyOn(L, 'tileLayer')

    // Act
    render(<RouteMap {...mapWith()} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(map.mock.calls[0][1]).toMatchObject({ preferCanvas: true, dragging: true })
    expect(tiles.mock.calls[0][1]).toMatchObject({ referrerPolicy: 'strict-origin', maxZoom: 18 })
    expect(String(tiles.mock.calls[0][1]?.attribution)).toContain('<a href="https://www.openstreetmap.org/copyright"')
  })

  it('on a narrow screen starts locked, collapses the layer list and hides stop labels until tapped', () => {
    // Arrange
    stubMatchMedia(['max-width: 640px'])
    const map = vi.spyOn(L, 'map')
    const layers = vi.spyOn(L.control, 'layers')
    const manifest = makeManifest({ stops: [makeStop(1)] })

    // Act
    const { container } = render(<RouteMap {...mapWith(manifest)} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(map.mock.calls[0][1]).toMatchObject({ dragging: false })
    expect(layers.mock.calls[0][2]).toMatchObject({ collapsed: true })
    expect(container.querySelector('.leaflet-tooltip')).toBeNull()
    expect(screen.getByRole('button', { name: 'Unlock map to move it' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lets a phone reader unlock panning, and lock it again', async () => {
    // Arrange
    stubMatchMedia(['max-width: 640px'])
    const map = vi.spyOn(L, 'map')
    const user = userEvent.setup()
    render(<RouteMap {...mapWith(makeManifest({ stops: [makeStop(1)] }))} selectedId={null} onSelect={vi.fn()} />)
    const instance = map.mock.results[0].value as L.Map
    expect(instance.dragging.enabled()).toBe(false)

    // Act
    await user.click(screen.getByRole('button', { name: 'Unlock map to move it' }))

    // Assert
    expect(screen.getByRole('button', { name: 'Lock map to scroll the page' })).toHaveAttribute('aria-pressed', 'true')
    expect(instance.dragging.enabled()).toBe(true)

    // Act
    await user.click(screen.getByRole('button', { name: 'Lock map to scroll the page' }))

    // Assert
    expect(instance.dragging.enabled()).toBe(false)
  })

  it('on a wide screen shows labels, an open layer list and no lock button', () => {
    // Arrange
    const layers = vi.spyOn(L.control, 'layers')
    const manifest = makeManifest({ stops: [makeStop(1)] })

    // Act
    const { container } = render(<RouteMap {...mapWith(manifest)} selectedId={null} onSelect={vi.fn()} />)

    // Assert
    expect(layers.mock.calls[0][2]).toMatchObject({ collapsed: false })
    expect(container.querySelector('.leaflet-tooltip')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /map/i })).not.toBeInTheDocument()
  })
})

describe('RouteMap — selection', () => {
  // flyTo is stubbed in this block: the tests ask WHICH movement was requested, and a real zoom
  // animation leaves a Leaflet redraw pending that jsdom runs after the map is gone.
  beforeEach(() => {
    vi.spyOn(L.Map.prototype, 'flyTo').mockImplementation(function (this: L.Map) { return this })
  })

  const checkpointPosition = fix(-26.2, 28.0)
  const manifest = makeManifest({
    checkpoints: [
      makeCheckpoint({ checkpoint_id: 'cp-1', driver_phone: checkpointPosition }),
      makeCheckpoint({ checkpoint_id: 'cp-2', recorded_at: '2026-09-12T11:00:00Z', driver_phone: fix(-26.3, 28.1) }),
    ],
    phases: [makePhase(3, 'departure', { driver_phone: fix(-26.4, 28.2) })],
  })

  it('highlights the selected marker and puts the previous one back', () => {
    // Arrange
    const setStyle = vi.spyOn(L.CircleMarker.prototype, 'setStyle')
    const props = mapWith(manifest)
    const { rerender } = render(<RouteMap {...props} selectedId={null} onSelect={vi.fn()} />)
    setStyle.mockClear()

    // Act
    rerender(<RouteMap {...props} selectedId="cp-1" onSelect={vi.fn()} />)
    rerender(<RouteMap {...props} selectedId="cp-2" onSelect={vi.fn()} />)

    // Assert: cp-1 raised, then lowered when cp-2 was raised.
    const styles = setStyle.mock.calls.map(([style]) => (style as L.PathOptions).weight)
    expect(styles).toEqual([6, 3, 6])
  })

  it('gives a selected phase a temporary marker and removes it with the selection', () => {
    // Arrange
    const circleMarker = vi.spyOn(L, 'circleMarker')
    const props = mapWith(manifest)
    const { rerender } = render(<RouteMap {...props} selectedId={null} onSelect={vi.fn()} />)
    const before = circleMarker.mock.calls.length

    // Act
    rerender(<RouteMap {...props} selectedId="phase-3" onSelect={vi.fn()} />)
    const created = circleMarker.mock.calls.length - before
    const remove = vi.spyOn(circleMarker.mock.results[circleMarker.mock.results.length - 1].value as L.CircleMarker, 'remove')
    rerender(<RouteMap {...props} selectedId="cp-1" onSelect={vi.fn()} />)

    // Assert
    expect(created).toBe(1)
    expect(remove).toHaveBeenCalled()
  })

  it('flies to the selection normally, and jumps when the reader prefers reduced motion', () => {
    // Arrange
    const flyTo = vi.mocked(L.Map.prototype.flyTo)
    const props = mapWith(manifest)
    const { rerender } = render(<RouteMap {...props} selectedId={null} onSelect={vi.fn()} />)
    const setView = vi.spyOn(L.Map.prototype, 'setView').mockImplementation(function (this: L.Map) { return this })

    // Act: ordinary motion
    rerender(<RouteMap {...props} selectedId="cp-1" onSelect={vi.fn()} />)

    // Assert
    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(flyTo.mock.calls[0][2]).toMatchObject({ duration: 0.6 })
    expect(setView).not.toHaveBeenCalled()

    // Act: reduced motion
    stubMatchMedia(['prefers-reduced-motion'])
    rerender(<RouteMap {...props} selectedId="cp-2" onSelect={vi.fn()} />)

    // Assert
    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(setView).toHaveBeenCalledTimes(1)
    expect(setView.mock.calls[0][2]).toMatchObject({ animate: false })
  })
})
