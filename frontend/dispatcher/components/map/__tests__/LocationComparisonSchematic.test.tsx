import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LocationComparisonSchematic } from '../LocationComparisonSchematic'
import { BOUNDARY_NEARBY_METRES, type LocationEvidence } from '@/lib/phase/location-evidence'

const DRIVER_COORDS = { lat: -33.9249, lng: 18.4241 }
const TRACKER_COORDS = { lat: -33.9260, lng: 18.4241 }

function makeEvidence(overrides: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    driverFix: {
      source: 'driver_phone',
      label: 'Driver phone',
      coords: DRIVER_COORDS,
      capturedAt: '2026-01-01T10:00:00Z',
      captureNote: null,
    },
    trackerFix: {
      source: 'horse_tracker',
      label: 'Horse tracker',
      coords: TRACKER_COORDS,
      capturedAt: null,
      captureNote: 'Captured within the corroboration window of the driver capture',
    },
    separationMetres: 122,
    verdict: 'within_tolerance',
    boundary: null,
    ...overrides,
  }
}

describe('LocationComparisonSchematic', () => {
  it('draws both fixes with distinct testids, a separation line, separation text, and a scale label', () => {
    const { container } = render(<LocationComparisonSchematic evidence={makeEvidence()} />)

    expect(screen.getByTestId('fix-driver_phone')).toBeInTheDocument()
    expect(screen.getByTestId('fix-horse_tracker')).toBeInTheDocument()
    expect(screen.getByTestId('separation-line')).toBeInTheDocument()
    expect(screen.getByText('122 m')).toBeInTheDocument()
    expect(screen.getByTestId('schematic-scale-label')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid="fix-driver_phone"]')).toHaveLength(1)
  })

  it('draws both markers but no separation line for coincident fixes, and keeps both labels readable', () => {
    const evidence = makeEvidence({
      trackerFix: {
        source: 'horse_tracker',
        label: 'Horse tracker',
        coords: DRIVER_COORDS,
        capturedAt: null,
        captureNote: 'Captured within the corroboration window of the driver capture',
      },
      separationMetres: 0,
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.getByTestId('fix-driver_phone')).toBeInTheDocument()
    expect(screen.getByTestId('fix-horse_tracker')).toBeInTheDocument()
    expect(screen.queryByTestId('separation-line')).not.toBeInTheDocument()
    expect(screen.getByText('Driver phone')).toBeInTheDocument()
    expect(screen.getByText('Horse tracker')).toBeInTheDocument()
  })

  it('renders a lone driver fix with no line and no crash', () => {
    const evidence = makeEvidence({ trackerFix: null, separationMetres: null })
    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.getByTestId('fix-driver_phone')).toBeInTheDocument()
    expect(screen.queryByTestId('fix-horse_tracker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('separation-line')).not.toBeInTheDocument()
  })

  it('renders a very large separation (300 km) with finite coordinates and a nice scale value', () => {
    const evidence = makeEvidence({
      trackerFix: {
        source: 'horse_tracker',
        label: 'Horse tracker',
        coords: { lat: -31.2, lng: 18.4241 },
        capturedAt: null,
        captureNote: 'Captured within the corroboration window of the driver capture',
      },
      separationMetres: 300_000,
    })
    const { container } = render(<LocationComparisonSchematic evidence={evidence} />)

    expect(container.innerHTML).not.toContain('NaN')
    expect(container.innerHTML).not.toContain('Infinity')

    const scaleLabel = screen.getByTestId('schematic-scale-label').textContent
    expect(scaleLabel).toMatch(/^\d+(\.\d+)? m$/)
    const scaleMetres = Number(scaleLabel?.replace(' m', ''))
    expect(scaleMetres).toBeGreaterThan(0)
  })

  it('draws the boundary circle and reference label only when a boundary is recorded', () => {
    const withBoundary = makeEvidence({
      boundary: {
        coords: { lat: -33.9255, lng: 18.4241 },
        radiusMetres: 150,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })
    const { rerender } = render(<LocationComparisonSchematic evidence={withBoundary} />)

    expect(screen.getByTestId('boundary-circle')).toBeInTheDocument()
    expect(screen.getByText('Current precinct boundary (reference only)')).toBeInTheDocument()

    rerender(<LocationComparisonSchematic evidence={makeEvidence({ boundary: null })} />)
    expect(screen.queryByTestId('boundary-circle')).not.toBeInTheDocument()
  })

  it('never fabricates a zero separation when both fixes are present but separationMetres is null', () => {
    const evidence = makeEvidence({ separationMetres: null })
    const { container } = render(<LocationComparisonSchematic evidence={evidence} />)

    const line = screen.getByTestId('separation-line')
    expect(line).toBeInTheDocument()
    expect(line.parentElement?.querySelector('text')).not.toBeInTheDocument()
    expect(screen.queryByText('0 m')).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('>0 m<')

    const svg = screen.getByRole('img')
    expect(svg.getAttribute('aria-label')).not.toMatch(/apart/)
  })

  it('names the fixes drawn in its aria-label', () => {
    render(<LocationComparisonSchematic evidence={makeEvidence()} />)

    const svg = screen.getByRole('img')
    expect(svg.getAttribute('aria-label')).toMatch(/Driver phone/)
    expect(svg.getAttribute('aria-label')).toMatch(/Horse tracker/)
  })

  it('flips each label\'s text-anchor to the side away from the other marker', () => {
    const evidence = makeEvidence({
      driverFix: {
        source: 'driver_phone',
        label: 'Driver phone',
        coords: { lat: -33.9249, lng: 18.4200 },
        capturedAt: '2026-01-01T10:00:00Z',
        captureNote: null,
      },
      trackerFix: {
        source: 'horse_tracker',
        label: 'Horse tracker',
        coords: { lat: -33.9249, lng: 18.4300 },
        capturedAt: null,
        captureNote: 'Captured within the corroboration window of the driver capture',
      },
      separationMetres: 924,
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    const driverLabel = screen.getByText('Driver phone')
    const trackerLabel = screen.getByText('Horse tracker')

    expect(driverLabel.getAttribute('text-anchor')).toBe('end')
    expect(trackerLabel.getAttribute('text-anchor')).toBe('start')
  })

  it('flips the anchors again when the same two fixes swap sides', () => {
    const evidence = makeEvidence({
      driverFix: {
        source: 'driver_phone',
        label: 'Driver phone',
        coords: { lat: -33.9249, lng: 18.4300 },
        capturedAt: '2026-01-01T10:00:00Z',
        captureNote: null,
      },
      trackerFix: {
        source: 'horse_tracker',
        label: 'Horse tracker',
        coords: { lat: -33.9249, lng: 18.4200 },
        capturedAt: null,
        captureNote: 'Captured within the corroboration window of the driver capture',
      },
      separationMetres: 924,
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.getByText('Driver phone').getAttribute('text-anchor')).toBe('start')
    expect(screen.getByText('Horse tracker').getAttribute('text-anchor')).toBe('end')
  })

  it('keeps the boundary caption\'s x position within the viewBox even near the frame edge', () => {
    const evidence = makeEvidence({
      boundary: {
        coords: { lat: -33.9255, lng: 18.4341 },
        radiusMetres: 150,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    const caption = screen.getByText('Current precinct boundary (reference only)')
    const x = Number(caption.getAttribute('x'))
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(320)
  })

  it('draws the boundary circle without a caption when the circle is too small to read', () => {
    const evidence = makeEvidence({
      trackerFix: {
        source: 'horse_tracker',
        label: 'Horse tracker',
        coords: { lat: -31.2, lng: 18.4241 },
        capturedAt: null,
        captureNote: 'Captured within the corroboration window of the driver capture',
      },
      separationMetres: 300_000,
      boundary: {
        coords: DRIVER_COORDS,
        radiusMetres: 50,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.getByTestId('boundary-circle')).toBeInTheDocument()
    expect(screen.queryByText('Current precinct boundary (reference only)')).not.toBeInTheDocument()
  })
  it(`leaves out a boundary farther than ${BOUNDARY_NEARBY_METRES} m from every fix, so the fixes stay readable`, () => {
    const evidence = makeEvidence({
      boundary: {
        coords: { lat: DRIVER_COORDS.lat + 12.6, lng: DRIVER_COORDS.lng },
        radiusMetres: 150,
        precinctName: 'Johannesburg DC',
        provenance: 'current_reference_only',
      },
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.queryByTestId('boundary-circle')).not.toBeInTheDocument()
    expect(screen.queryByText('Current precinct boundary (reference only)')).not.toBeInTheDocument()
    expect(screen.getByTestId('separation-line')).toBeInTheDocument()
    expect(screen.getByText('122 m')).toBeInTheDocument()
  })

  it('still draws a far boundary when there is no fix at all to frame on instead', () => {
    const evidence = makeEvidence({
      driverFix: null,
      trackerFix: null,
      separationMetres: null,
      boundary: {
        coords: { lat: DRIVER_COORDS.lat + 12.6, lng: DRIVER_COORDS.lng },
        radiusMetres: 150,
        precinctName: 'Johannesburg DC',
        provenance: 'current_reference_only',
      },
    })
    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.getByTestId('boundary-circle')).toBeInTheDocument()
  })
})

describe('LocationComparisonSchematic outline boundary', () => {
  it('test_draws_an_outline_boundary_as_a_polygon', () => {
    const evidence = makeEvidence({
      boundary: {
        coords: { lat: -33.9255, lng: 18.4241 },
        radiusMetres: 80,
        polygon: [[-33.925, 18.4236], [-33.925, 18.4246], [-33.926, 18.4246], [-33.926, 18.4236]],
        precinctName: 'Cape Town DC',
        provenance: 'recorded_snapshot',
      },
    })

    render(<LocationComparisonSchematic evidence={evidence} />)

    expect(screen.getByTestId('boundary-outline').getAttribute('points')?.split(' ')).toHaveLength(4)
    expect(screen.queryByTestId('boundary-circle')).not.toBeInTheDocument()
  })
})
