import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PositionDisagreement } from './PositionDisagreement'
import { makePhase } from './__tests__/testFixtures'

describe('PositionDisagreement', () => {
  it('renders both source positions and the separation between them', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: -33.9351,
          horse_gps_lng: 18.4241,
          pulsit_geofence_confirmed: false,
        })}
      />,
    )

    expect(screen.getByText('Driver phone')).toBeInTheDocument()
    expect(screen.getByText('Vehicle tracker')).toBeInTheDocument()
    expect(screen.getByText('-33.924900, 18.424100')).toBeInTheDocument()
    expect(screen.getByText('-33.935100, 18.424100')).toBeInTheDocument()
    // ~1.13 km apart at these coordinates — rendered in km, not metres, above the threshold.
    expect(screen.getByText('1.1 km')).toBeInTheDocument()
  })

  it('renders a sub-kilometre gap as whole metres, not a rounded-off kilometre figure', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: -33.92760,
          horse_gps_lng: 18.4241,
        })}
      />,
    )

    // ~300 m apart — must read as metres, since the story explicitly rules out "0.3 km".
    expect(screen.getByText(/^\d+ m$/)).toBeInTheDocument()
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument()
  })

  it('states plainly when the tracker reported no position, without inventing a distance', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: null,
          horse_gps_lng: null,
        })}
      />,
    )

    expect(screen.getByText('Vehicle tracker')).toBeInTheDocument()
    expect(screen.getByText('No fix recorded')).toBeInTheDocument()
    expect(screen.getByText('Not computable')).toBeInTheDocument()
    // Never a bogus zero-metre separation when one source is silent.
    expect(screen.queryByText('0 m')).not.toBeInTheDocument()
  })

  it('states plainly when the driver phone reported no position, symmetric with the tracker case', () => {
    render(
      <PositionDisagreement
        phase={makePhase('departure', {
          driver_phone_lat: null,
          driver_phone_lng: null,
          horse_gps_lat: -33.9249,
          horse_gps_lng: 18.4241,
        })}
      />,
    )

    expect(screen.getByText('Driver phone')).toBeInTheDocument()
    expect(screen.getByText('No fix recorded')).toBeInTheDocument()
    expect(screen.getByText('Not computable')).toBeInTheDocument()
  })

  it('renders both positions and a separation for a phase with no resolvable precinct', () => {
    // stop_sequence is null (trip_creation is the phase type where that is legitimate —
    // phase.ts). The component takes no precinct prop at all, so it must render regardless.
    render(
      <PositionDisagreement
        phase={makePhase('trip_creation', {
          stop_sequence: null,
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          horse_gps_lat: -33.9351,
          horse_gps_lng: 18.4241,
        })}
      />,
    )

    expect(screen.getByText('Driver phone')).toBeInTheDocument()
    expect(screen.getByText('Vehicle tracker')).toBeInTheDocument()
    expect(screen.getByText('1.1 km')).toBeInTheDocument()
  })
})
