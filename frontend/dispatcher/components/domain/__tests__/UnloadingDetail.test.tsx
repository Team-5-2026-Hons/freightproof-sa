import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UnloadingDetail } from '../UnloadingDetail'
import { VIEW_ON_MAP_LABEL } from '../LocationEvidencePanel'
import { makePhase } from './testFixtures'

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

describe('UnloadingDetail', () => {
  it('shows the live scanned-in count and the short-scan verdict', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'in_progress' }}
        precinct={undefined}
        scannedInCount={2}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText('Scanned off truck (live)')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/1 not scanned/i)).toBeInTheDocument()
  })

  it('shows the all-scanned verdict when the live count meets the manifest baseline', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'completed' }}
        precinct={undefined}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText(/all parcels scanned/i)).toBeInTheDocument()
  })

  it('shows nothing scanned as unrecorded, not zero, when no consignments are booked at this stop', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'in_progress' }}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.queryByText(/not scanned/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/all parcels scanned/i)).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('notes the scan is in progress while unloading is still open', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'in_progress' }}
        precinct={undefined}
        scannedInCount={1}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.getByText(/scan in progress/i)).toBeInTheDocument()
  })

  it('drops the in-progress note once the phase resolves', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'completed' }}
        precinct={undefined}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.queryByText(/scan in progress/i)).not.toBeInTheDocument()
  })

  it('never renders seal content, even when the phase row still carries a seal_number', () => {
    render(
      <UnloadingDetail
        phase={{ ...makePhase('unloading'), status: 'completed', seal_number: 'SEAL-A' }}
        precinct={undefined}
        scannedInCount={3}
        expectedAtStopCount={3}
      />,
    )

    expect(screen.queryByText('Seal as found')).not.toBeInTheDocument()
    expect(screen.queryByText(/seal/i)).not.toBeInTheDocument()
  })
})

describe('UnloadingDetail: location section', () => {
  it('shows no location heading when neither a fix nor a stored verdict is recorded', () => {
    render(
      <UnloadingDetail
        phase={makePhase('unloading', { status: 'completed' })}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.queryByText('Location at unloading')).not.toBeInTheDocument()
  })

  it('shows the heading and the comparison disclosure when a driver fix was recorded', () => {
    render(
      <UnloadingDetail
        phase={makePhase('unloading', { status: 'completed', driver_phone_lat: -33.9249, driver_phone_lng: 18.4241 })}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.getByText('Location at unloading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('shows the heading and the stored verdict, with no "View on map" button, when only a verdict was recorded', () => {
    render(
      <UnloadingDetail
        phase={makePhase('unloading', { status: 'completed', pulsit_geofence_confirmed: false })}
        precinct={undefined}
        scannedInCount={null}
        expectedAtStopCount={null}
      />,
    )

    expect(screen.getByText('Location at unloading')).toBeInTheDocument()
    expect(screen.getByText('Truck outside precinct tolerance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: VIEW_ON_MAP_LABEL })).not.toBeInTheDocument()
  })
})
