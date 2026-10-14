import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PositionDisagreement } from './PositionDisagreement'
import { VIEW_ON_MAP_LABEL } from './LocationEvidencePanel'
import { makePhase } from './__tests__/testFixtures'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { fmtDateTime } from '@shared/lib/utils/datetime'

const PRECINCT = mockPrecincts[0]!

describe('PositionDisagreement', () => {
  it('states the stored trigger explicitly, never as a phone-vs-tracker disagreement or an unstated "reason"', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', { pulsit_geofence_confirmed: false })}
        precinct={undefined}
        source="system"
      />,
    )

    expect(screen.getByTestId('gps-mismatch-trigger')).toHaveTextContent('Vehicle tracker outside the facility boundary')
    expect(screen.queryByText(/disagreement/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/reason/i)).not.toBeInTheDocument()
  })

  it('renders no trigger line for a driver-raised gps_mismatch (a driver row carries no tracker verdict)', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', { pulsit_geofence_confirmed: false })}
        precinct={undefined}
        source="driver"
      />,
    )

    expect(screen.queryByTestId('gps-mismatch-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText('Vehicle tracker outside the facility boundary')).not.toBeInTheDocument()
    // The linked-phase-locations panel still renders regardless of source.
    expect(screen.getByText(/Linked phase locations/)).toBeInTheDocument()
  })

  it('labels the phase fixes as linked phase locations, with the phase completion time', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', { completed_at: '2026-05-09T07:04:00Z' })}
        precinct={undefined}
        source="system"
      />,
    )

    expect(screen.getByText(`Linked phase locations · ${fmtDateTime('2026-05-09T07:04:00Z')}`)).toBeInTheDocument()
  })

  it('says plainly when the linked phase has not completed, rather than inventing a time', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', { completed_at: null })}
        precinct={undefined}
        source="system"
      />,
    )

    expect(screen.getByText('Linked phase locations · Phase not completed')).toBeInTheDocument()
  })

  it('shows the separation and the comparison disclosure inside the panel when both fixes are present', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: -33.9351,
          horse_gps_lng: 18.4241,
        })}
        precinct={undefined}
        source="system"
      />,
    )

    expect(screen.getByText('1.1 km')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('forwards hideMapButton to suppress its own "View on map" button when a caller already shows one', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: -33.9351,
          horse_gps_lng: 18.4241,
        })}
        precinct={undefined}
        source="system"
        hideMapButton
      />,
    )

    expect(screen.queryByRole('button', { name: VIEW_ON_MAP_LABEL })).not.toBeInTheDocument()
    // Still shows the underlying comparison data — only the button is suppressed.
    expect(screen.getByText('1.1 km')).toBeInTheDocument()
  })

  it('shows the driver point and "Comparison unavailable" when the tracker fix is missing', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: null,
          horse_gps_lng: null,
        })}
        precinct={undefined}
        source="system"
      />,
    )

    expect(screen.getByText('-33.924900, 18.424100')).toBeInTheDocument()
    expect(screen.getByText('Comparison unavailable')).toBeInTheDocument()
  })

  it('renders the stored outside-tolerance verdict, alongside the trigger line (not in place of it)', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', { pulsit_geofence_confirmed: false })}
        precinct={undefined}
        source="system"
      />,
    )

    expect(screen.getByTestId('gps-mismatch-trigger')).toBeInTheDocument()
    expect(screen.getByText('Truck outside precinct tolerance')).toBeInTheDocument()
  })

  it('states there is no boundary recorded when the precinct cannot be resolved', () => {
    render(
      <PositionDisagreement phase={makePhase('departure')} precinct={undefined} source="system" />,
    )

    expect(screen.getByText('No boundary recorded for this phase')).toBeInTheDocument()
  })

  it('shows the reference-boundary label and precinct name when a precinct is resolved', () => {
    render(
      <PositionDisagreement phase={makePhase('departure')} precinct={PRECINCT} source="system" />,
    )

    expect(screen.getByText(new RegExp(`Current precinct boundary \\(reference only\\): ${PRECINCT.name}`))).toBeInTheDocument()
  })
})
