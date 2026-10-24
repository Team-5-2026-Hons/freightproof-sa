import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ApiError } from '@/lib/api/client'
import { incidentSheetPdf, listIncidentDeclarations, saveBlob } from '@/lib/api/auditPacks'
import type { IncidentDeclaration } from '@/lib/types/auditPack'
import { TripPoliceDetails } from './TripPoliceDetails'

// The API client builds a Supabase client at import time.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return { ...actual, listIncidentDeclarations: vi.fn(), incidentSheetPdf: vi.fn(), saveBlob: vi.fn() }
})

function declaration(overrides: Partial<IncidentDeclaration> = {}): IncidentDeclaration {
  return {
    declaration_id: 'd-1', exception_id: null, saps_station: 'Harrismith SAPS', saps_cas_number: '123/09/2026',
    saps_officer: null, reported_to_saps_at: null, tracking_company_notified_at: null, insurer_notified_at: null,
    client_notified_at: null, insurer_claim_reference: null, note: null, declared_by_name: 'Ops Desk',
    declared_at: '2026-09-13T06:00:00Z', tier: 'declared', ...overrides,
  }
}

function renderDetails(props: Partial<React.ComponentProps<typeof TripPoliceDetails>> = {}) {
  const onDeclare = vi.fn()
  const view = render(<ToastProvider><TripPoliceDetails tripId="trip-1" tripReference="TRP-0042" showSection canBuildSheet onDeclare={onDeclare} {...props} /></ToastProvider>)
  return { onDeclare, ...view }
}

beforeEach(() => {
  vi.mocked(listIncidentDeclarations).mockReset().mockResolvedValue([])
  vi.mocked(incidentSheetPdf).mockReset()
  vi.mocked(saveBlob).mockReset()
})

describe('TripPoliceDetails', () => {
  it('lists declared police details', async () => {
    vi.mocked(listIncidentDeclarations).mockResolvedValue([declaration()])

    renderDetails()

    const section = await screen.findByRole('region', { name: 'Police and notifications' })
    expect(await within(section).findByText('CAS 123/09/2026')).toBeInTheDocument()
    expect(within(section).getByText(/Harrismith SAPS/)).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: 'Police & notifications' })).toBeInTheDocument()
  })

  it('shows the missing case number as a row, not a nested card', async () => {
    renderDetails()

    const section = await screen.findByRole('region', { name: 'Police and notifications' })
    expect(await within(section).findByText('Not recorded')).toBeInTheDocument()
    expect(within(section).getByText('SAPS case no.')).toBeInTheDocument()
  })

  it('shows a skeleton row, not nothing, while the declarations load', () => {
    vi.mocked(listIncidentDeclarations).mockReturnValue(new Promise(() => {}))

    renderDetails()

    expect(screen.getByRole('status', { name: 'Loading police details' })).toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
  })

  it('says so when the declarations cannot be read, rather than claiming nothing is recorded', async () => {
    vi.mocked(listIncidentDeclarations).mockRejectedValue(new ApiError(503, 'Audit service unavailable.'))

    renderDetails()

    expect(await screen.findByText('Audit service unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
  })

  it('opens the declaration dialog through its callback', async () => {
    const { onDeclare } = renderDetails()

    await userEvent.click(await screen.findByRole('button', { name: 'Record police details' }))

    expect(onDeclare).toHaveBeenCalledOnce()
  })

  it('downloads the incident fact sheet', async () => {
    const pdf = new Blob(['pdf'])
    vi.mocked(incidentSheetPdf).mockResolvedValue(pdf)
    renderDetails()

    await userEvent.click(await screen.findByRole('button', { name: 'Incident fact sheet' }))

    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(pdf, 'TRP-0042-incident-sheet.pdf'))
  })

  it('explains a trip with no incident when the fact sheet is refused', async () => {
    vi.mocked(incidentSheetPdf).mockRejectedValue(new ApiError(409, 'This trip has no critical incident to report.'))
    renderDetails()

    await userEvent.click(await screen.findByRole('button', { name: 'Incident fact sheet' }))

    expect(await screen.findByText('This trip has no critical incident to report.')).toBeInTheDocument()
  })

  it('reads the declarations again in place when the caller bumps refreshKey', async () => {
    vi.mocked(listIncidentDeclarations).mockResolvedValueOnce([]).mockResolvedValue([declaration()])
    const { rerender } = renderDetails()
    const trigger = await screen.findByRole('button', { name: 'Record police details' })

    rerender(<ToastProvider><TripPoliceDetails tripId="trip-1" tripReference="TRP-0042" showSection canBuildSheet onDeclare={vi.fn()} refreshKey={1} /></ToastProvider>)

    expect(await screen.findByText('CAS 123/09/2026')).toBeInTheDocument()
    // The same button element: nothing remounted, so focus and scroll are undisturbed.
    expect(screen.getByRole('button', { name: 'Record police details' })).toBe(trigger)
    expect(listIncidentDeclarations).toHaveBeenCalledTimes(2)
  })

  it('renders nothing for a trip with no incident and nothing recorded', async () => {
    renderDetails({ showSection: false, canBuildSheet: false })

    await waitFor(() => expect(listIncidentDeclarations).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Police and notifications' })).not.toBeInTheDocument()
  })

  it('still shows what is recorded when nothing else qualifies, but offers no fact sheet', async () => {
    vi.mocked(listIncidentDeclarations).mockResolvedValue([declaration()])

    renderDetails({ showSection: false, canBuildSheet: false })

    expect(await screen.findByText('CAS 123/09/2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Incident fact sheet' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record police details' })).toBeInTheDocument()
  })

  it('offers the fact sheet only when the server can build one, whatever else qualifies', async () => {
    renderDetails({ showSection: true, canBuildSheet: false })

    expect(await screen.findByRole('button', { name: 'Record police details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Incident fact sheet' })).not.toBeInTheDocument()
  })
})
