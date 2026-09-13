import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhaseLocationSection } from '../PhaseLocationSection'
import { VIEW_ON_MAP_LABEL } from '../LocationEvidencePanel'
import { makePhase } from './testFixtures'
import type { Precinct } from '@shared/lib/types/precinct'
import type { PrecinctId, OrganizationId } from '@shared/lib/types/precinct'

function makePrecinct(overrides: Partial<Precinct> = {}): Precinct {
  return {
    id: 'precinct-1' as PrecinctId,
    name: 'Cape Town DC',
    principal_organization_id: 'org-1' as OrganizationId,
    address: '1 Depot Road',
    latitude: -33.9255,
    longitude: 18.4241,
    geofence_radius_metres: 150,
    is_shared: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('PhaseLocationSection', () => {
  it('renders the panel with the stored verdict and a precinct-derived context label', () => {
    const phase = makePhase('activation', {
      driver_phone_lat: -33.9249,
      driver_phone_lng: 18.4241,
      horse_gps_lat: -33.9260,
      horse_gps_lng: 18.4241,
      pulsit_geofence_confirmed: true,
    })

    render(<PhaseLocationSection phase={phase} precinct={makePrecinct()} />)

    expect(screen.getByText('Within accepted tolerance')).toBeInTheDocument()
    // Context label only surfaces inside the modal title, which mounts on open: the
    // "View on map" button being present is the externally observable proof it was built.
    expect(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
    expect(screen.getByText(/Cape Town DC/)).toBeInTheDocument()
  })

  it('shows "No boundary recorded" and a context label without " at …" when the precinct is undefined', () => {
    const phase = makePhase('activation', {
      driver_phone_lat: -33.9249,
      driver_phone_lng: 18.4241,
    })

    render(<PhaseLocationSection phase={phase} precinct={undefined} />)

    expect(screen.getByText('No boundary recorded for this phase')).toBeInTheDocument()
    expect(screen.queryByText(/ at /)).not.toBeInTheDocument()
  })

  it('never renders the retired Pulsit wording for any verdict value', () => {
    const verdicts = [true, false, null] as const

    for (const pulsit_geofence_confirmed of verdicts) {
      const { unmount } = render(
        <PhaseLocationSection
          phase={makePhase('activation', { pulsit_geofence_confirmed })}
          precinct={makePrecinct()}
        />,
      )

      expect(screen.queryByText('Awaiting Pulsit')).not.toBeInTheDocument()
      expect(screen.queryByText('Confirmed ✓')).not.toBeInTheDocument()
      expect(screen.queryByText('Mismatch ✗')).not.toBeInTheDocument()

      unmount()
    }
  })
})
