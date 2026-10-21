import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '@shared/lib/types/trip'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ToastProvider } from '@/lib/context/ToastContext'
import { reportIncident } from '@/lib/api/incidents'
import type { IncidentDetail } from '@/lib/types/incident'
import { ReportIncidentDialog, type ReportPrefill } from './ReportIncidentDialog'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/incidents', () => ({ reportIncident: vi.fn() }))

// No manifest yet: the parcel picker must say so rather than show an empty list.
vi.mock('@/lib/hooks/useManifest', () => ({ useManifest: () => ({ manifest: null }) }))

const activeTrip: Trip = { ...mockTrips[0]!, status: 'active', exceptions: [] }

function renderDialog(trip: Trip = activeTrip, prefill?: ReportPrefill) {
  const onReported = vi.fn()
  render(
    <ToastProvider>
      <ReportIncidentDialog trip={trip} open takenExceptionIds={new Set()} prefill={prefill} onClose={vi.fn()} onReported={onReported} />
    </ToastProvider>,
  )
  return { onReported }
}

beforeEach(() => {
  vi.mocked(reportIncident).mockReset()
})

describe('ReportIncidentDialog', () => {
  it('defaults a hijacking on a live trip to stopping it and naming the whole load', async () => {
    // Arrange
    vi.mocked(reportIncident).mockResolvedValue({ reference: 'INC1', trip_stopped_at: '2026-10-20T10:00:00Z' } as IncidentDetail)
    const { onReported } = renderDialog()
    await userEvent.selectOptions(screen.getByLabelText('Incident type'), 'hijacking')
    await userEvent.type(screen.getByLabelText('What was reported'), 'Tracker says truck taken near Harrismith')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Record incident and stop trip' }))

    // Assert
    expect(reportIncident).toHaveBeenCalledWith(activeTrip.id, expect.objectContaining({
      incident_type: 'hijacking', stop_trip: true, all_parcels: true, parcel_ids: [], confidence: 'reported',
    }))
    expect(onReported).toHaveBeenCalledOnce()
  })

  it('lets the dispatcher untick the stop before saving', async () => {
    // Arrange
    vi.mocked(reportIncident).mockResolvedValue({ reference: 'INC1', trip_stopped_at: null } as IncidentDetail)
    renderDialog()
    await userEvent.selectOptions(screen.getByLabelText('Incident type'), 'hijacking')
    await userEvent.type(screen.getByLabelText('What was reported'), 'Unconfirmed call')
    await userEvent.click(screen.getByRole('switch', { name: 'Stop this trip' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Record incident' }))

    // Assert
    expect(reportIncident).toHaveBeenCalledWith(activeTrip.id, expect.objectContaining({ stop_trip: false }))
  })

  it('never offers to stop a trip that already ended', () => {
    // Arrange / Act
    renderDialog({ ...activeTrip, status: 'closed' })

    // Assert
    expect(screen.queryByRole('switch', { name: 'Stop this trip' })).not.toBeInTheDocument()
  })

  it('keeps Record disabled until something was reported', () => {
    // Arrange / Act
    renderDialog()

    // Assert
    expect(screen.getByRole('button', { name: 'Record incident' })).toBeDisabled()
  })

  it('opens from an alert as a suspected FreightProof report grouping that exception', async () => {
    // Arrange
    vi.mocked(reportIncident).mockResolvedValue({ reference: 'INC1', trip_stopped_at: null } as IncidentDetail)
    renderDialog({ ...activeTrip, status: 'closed' }, { incidentType: 'parcel_shortage', exceptionIds: ['exc-1'], summary: '3 parcels short' })

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Record incident' }))

    // Assert
    expect(reportIncident).toHaveBeenCalledWith(activeTrip.id, expect.objectContaining({
      exception_ids: ['exc-1'], report_channel: 'in_app', reporter_role: 'freightproof', confidence: 'suspected',
      summary: '3 parcels short', stop_trip: false,
    }))
  })

  it('says when there is no parcel list to choose from yet', async () => {
    // Arrange
    renderDialog()

    // Act
    await userEvent.click(screen.getByLabelText('Choose parcels'))

    // Assert
    expect(screen.getByText(/No parcel list for this trip yet/)).toBeInTheDocument()
  })
})
