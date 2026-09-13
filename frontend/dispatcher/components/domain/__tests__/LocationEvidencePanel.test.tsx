import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocationEvidencePanel, VIEW_ON_MAP_LABEL } from '../LocationEvidencePanel'
import { LocationEvidenceSummary } from '../LocationEvidenceSummary'
import type { LocationEvidence } from '@/lib/phase/location-evidence'
import { fmtDateTime } from '@shared/lib/utils/datetime'

// HTMLDialogElement.showModal/close are stubbed globally in vitest.setup.ts (jsdom does
// not implement them natively); the "View on map" button below opens the real Modal.

// LocationComparisonMap dynamically imports Leaflet inside an effect (no Leaflet runtime
// in jsdom), so every test that opens the modal must stub it with a plain, synchronously
// rendered placeholder, the same approach task R1 used for other Leaflet-backed maps.
// The component under test also imports boundaryDistanceMetres/boundaryIsNearby (pure
// functions, no Leaflet) from this same module, so the mock spreads the real module via
// importOriginal and overrides only the component, rather than replacing every export.
vi.mock('@/components/map/LocationComparisonMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/map/LocationComparisonMap')>()
  return {
    ...actual,
    LocationComparisonMap: () => <div data-testid="comparison-map" />,
  }
})

const DRIVER_COORDS = { lat: -33.924900, lng: 18.424100 }
const TRACKER_COORDS = { lat: -33.926000, lng: 18.424100 }

// Roughly 1,400 km north of the fixes above (a pure latitude offset, so the great-circle
// distance is close to 111.32 km per degree times this delta): far past the map's
// BOUNDARY_NEARBY_METRES default-frame threshold, standing in for the brief's "fix
// 1,400 km from its precinct" case that motivates the Distance to precinct centre row.
const FAR_BOUNDARY_COORDS = { lat: -21.33, lng: 18.424100 }

function makeEvidence(overrides: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    driverFix: {
      source: 'driver_phone',
      label: 'Driver phone',
      coords: DRIVER_COORDS,
      capturedAt: '2026-01-05T09:30:00Z',
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
    boundary: {
      coords: { lat: -33.9255, lng: 18.4241 },
      radiusMetres: 150,
      precinctName: 'Cape Town DC',
      provenance: 'current_reference_only',
    },
    ...overrides,
  }
}

describe('LocationEvidencePanel', () => {
  it('shows both fixes, driver capture time, tracker note, separation, verdict and boundary', () => {
    render(<LocationEvidencePanel evidence={makeEvidence()} contextLabel="Activation at Cape Town DC" />)

    expect(screen.getByText('-33.924900, 18.424100')).toBeInTheDocument()
    expect(screen.getByText('-33.926000, 18.424100')).toBeInTheDocument()
    // Formatted with the same function under test, so this assertion is TZ-portable.
    expect(screen.getByText(fmtDateTime('2026-01-05T09:30:00Z'))).toBeInTheDocument()
    expect(screen.getByText('Captured within the corroboration window of the driver capture')).toBeInTheDocument()
    expect(screen.getByText('122 m')).toBeInTheDocument()
    expect(screen.getByText('Within accepted tolerance')).toBeInTheDocument()
    expect(screen.getByText(/Current precinct boundary \(reference only\).*Cape Town DC.*150 m radius/)).toBeInTheDocument()
  })

  it('shows "Capture time not recorded" when driver_captured_at is null, while the tracker always shows its note', () => {
    render(
      <LocationEvidencePanel
        evidence={makeEvidence({
          driverFix: {
            source: 'driver_phone',
            label: 'Driver phone',
            coords: DRIVER_COORDS,
            capturedAt: null,
            captureNote: null,
          },
        })}
        contextLabel="Activation at Cape Town DC"
      />,
    )

    expect(screen.getByText('Capture time not recorded')).toBeInTheDocument()
    expect(screen.getByText('Captured within the corroboration window of the driver capture')).toBeInTheDocument()
  })

  it('shows COMPARISON_UNAVAILABLE and the one recorded point when only one fix exists', () => {
    render(
      <LocationEvidencePanel
        evidence={makeEvidence({ trackerFix: null, separationMetres: null })}
        contextLabel="Activation at Cape Town DC"
      />,
    )

    expect(screen.getByText('-33.924900, 18.424100')).toBeInTheDocument()
    expect(screen.getByText('No fix recorded')).toBeInTheDocument()
    expect(screen.getByText('Comparison unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('renders no "View on map" button when neither fix is recorded', () => {
    render(
      <LocationEvidencePanel
        evidence={makeEvidence({ driverFix: null, trackerFix: null, separationMetres: null, boundary: null })}
        contextLabel="Activation at Cape Town DC"
      />,
    )

    expect(screen.queryByRole('button', { name: VIEW_ON_MAP_LABEL })).not.toBeInTheDocument()
    expect(screen.getAllByText('No fix recorded')).toHaveLength(2)
    expect(screen.getByText('No boundary recorded for this phase')).toBeInTheDocument()
  })

  it('distinguishes a stored false verdict from an unverified one', () => {
    const { rerender } = render(
      <LocationEvidencePanel evidence={makeEvidence({ verdict: 'outside_tolerance' })} contextLabel="Activation" />,
    )
    expect(screen.getByText('Outside accepted tolerance')).toBeInTheDocument()

    rerender(<LocationEvidencePanel evidence={makeEvidence({ verdict: 'not_verified' })} contextLabel="Activation" />)
    expect(screen.getByText('Not verified')).toBeInTheDocument()
    expect(screen.queryByText('Outside accepted tolerance')).not.toBeInTheDocument()
  })

  it('does not mount the map until "View on map" is clicked, then opens it with a legend and the separation/verdict rows, and returns focus on close', async () => {
    const user = userEvent.setup()
    render(<LocationEvidencePanel evidence={makeEvidence()} contextLabel="Activation at Cape Town DC" />)

    expect(screen.queryByTestId('comparison-map')).not.toBeInTheDocument()

    const viewOnMapButton = screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })
    // userEvent (not fireEvent) so the click carries the real-browser focus-on-click
    // behaviour: Modal's focus-return reads document.activeElement at open time.
    await user.click(viewOnMapButton)

    const dialog = await screen.findByRole('dialog', { name: 'Recorded locations: Activation at Cape Town DC' })
    expect(within(dialog).getByTestId('comparison-map')).toBeInTheDocument()
    expect(within(dialog).getByText('● Driver phone · ■ Horse tracker · ◌ Precinct boundary (reference only)'))
      .toBeInTheDocument()
    // The map is never the only carrier of the fact: separation and verdict repeated as InfoRows.
    expect(within(dialog).getByText('122 m')).toBeInTheDocument()
    expect(within(dialog).getByText('Within accepted tolerance')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(viewOnMapButton).toHaveFocus())
  })

  it('omits the boundary legend item when the phase has no boundary recorded', async () => {
    const user = userEvent.setup()
    render(
      <LocationEvidencePanel evidence={makeEvidence({ boundary: null })} contextLabel="Activation at Cape Town DC" />,
    )

    await user.click(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('● Driver phone · ■ Horse tracker')).toBeInTheDocument()
    expect(within(dialog).queryByText(/Current precinct boundary/)).not.toBeInTheDocument()
  })

  it('shows a "Distance to precinct centre" row for a boundary far from every recorded fix', async () => {
    const user = userEvent.setup()
    render(
      <LocationEvidencePanel
        evidence={makeEvidence({
          boundary: {
            coords: FAR_BOUNDARY_COORDS,
            radiusMetres: 150,
            precinctName: 'Johannesburg DC',
            provenance: 'current_reference_only',
          },
        })}
        contextLabel="Activation at Cape Town DC"
      />,
    )

    await user.click(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Distance to precinct centre (reference only)')).toBeInTheDocument()
    expect(within(dialog).getByText(/from nearest fix/)).toBeInTheDocument()
  })

  it('omits the "Distance to precinct centre" row for a boundary near the recorded fixes', async () => {
    const user = userEvent.setup()
    // makeEvidence()'s default boundary sits about 70 m from the driver fix, well inside
    // the map's default frame, so no distance row is needed alongside it.
    render(<LocationEvidencePanel evidence={makeEvidence()} contextLabel="Activation at Cape Town DC" />)

    await user.click(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('Distance to precinct centre')).not.toBeInTheDocument()
  })

  it('never touches the network across a full render and modal open', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    render(<LocationEvidencePanel evidence={makeEvidence()} contextLabel="Activation at Cape Town DC" />)
    fireEvent.click(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL }))
    await screen.findByRole('dialog')

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LocationEvidenceSummary', () => {
  function evidence(overrides: Partial<LocationEvidence> = {}): LocationEvidence {
    return {
      driverFix: null,
      trackerFix: null,
      separationMetres: null,
      verdict: 'not_checked_yet',
      boundary: null,
      ...overrides,
    }
  }

  it('shows a complete chip with the separation when within tolerance and both fixes exist', () => {
    render(<LocationEvidenceSummary evidence={evidence({
      driverFix: { source: 'driver_phone', label: 'Driver phone', coords: DRIVER_COORDS, capturedAt: null, captureNote: null },
      trackerFix: { source: 'horse_tracker', label: 'Horse tracker', coords: TRACKER_COORDS, capturedAt: null, captureNote: null },
      separationMetres: 122,
      verdict: 'within_tolerance',
    })} />)

    expect(screen.getByText('Within accepted tolerance')).toBeInTheDocument()
    expect(screen.getByText('122 m apart')).toBeInTheDocument()
  })

  it('shows an exception chip with "Comparison unavailable" when outside tolerance but only one fix exists', () => {
    render(<LocationEvidenceSummary evidence={evidence({
      driverFix: { source: 'driver_phone', label: 'Driver phone', coords: DRIVER_COORDS, capturedAt: null, captureNote: null },
      verdict: 'outside_tolerance',
    })} />)

    expect(screen.getByText('Outside accepted tolerance')).toBeInTheDocument()
    expect(screen.getByText('Comparison unavailable')).toBeInTheDocument()
  })

  it('renders nothing for a pending phase with no fix at all', () => {
    const { container } = render(<LocationEvidenceSummary evidence={evidence({ verdict: 'not_checked_yet' })} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the chip alone (no trailing text) for a not_verified phase with no fix', () => {
    render(<LocationEvidenceSummary evidence={evidence({ verdict: 'not_verified' })} />)

    expect(screen.getByText('Not verified')).toBeInTheDocument()
    expect(screen.queryByText('Comparison unavailable')).not.toBeInTheDocument()
  })
})
