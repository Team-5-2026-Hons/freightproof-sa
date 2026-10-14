import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TripDetailPanel } from './TripDetailPanel'
import { ToastProvider } from '@/lib/context/ToastContext'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctLabel } from '@/lib/phase/trip-detail'
import { cancelTrip } from '@/lib/api/client'
import type { ArtifactId, EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'
import { listAuditPacks, listIncidentDeclarations, recordIncidentDeclaration } from '@/lib/api/auditPacks'
import { ApiError } from '@/lib/api/client'

// CancelTripDialog's cancelTrip call reaches the API client, which builds a Supabase
// client at import time — same reason TripExceptionsPanel.test.tsx mocks this module.
// The exceptions tab's cards word a claim as mine or a colleague's.
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-me' } }) }))

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// Isolate from the real HTTP layer — the dialog must never call this during a dismissal.
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')
  return { ...actual, cancelTrip: vi.fn() }
})

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return { ...actual, listAuditPacks: vi.fn(), listIncidentDeclarations: vi.fn(), recordIncidentDeclaration: vi.fn() }
})
vi.mock('@/lib/hooks/useManifest', () => ({ useManifest: () => ({ manifest: null, isLoading: false, refetch: vi.fn() }) }))

const mockedCancelTrip = vi.mocked(cancelTrip)

// Supporting photos in the exceptions tab resolve through this map; most tests here never open that tab.
const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

const trip = mockTrips[0]!
// mockTrips[0] is a closed trip (TRP-2026-0035), so its own "Cancel trip" trigger is
// correctly hidden — the cancellation-dialog tests below need a still-cancellable trip,
// with the same stops/precincts fixture data, to exercise the trigger and dialog.
const activeTrip = { ...trip, status: 'active' as const }

function renderPanel(onChanged = vi.fn(), tripOverride = trip, extra: Partial<React.ComponentProps<typeof TripDetailPanel>> = {}) {
  return { onChanged, ...render(
    <ToastProvider>
      <TripDetailPanel
        panel="information"
        trip={tripOverride}
        precincts={mockPrecincts}
        filter="needs_review"
        artifactsById={NO_ARTIFACTS}
        overlayOpen
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onFilter={vi.fn()}
        onChanged={onChanged}
        returnTo="/trips/trip-1"
        {...extra}
      />
    </ToastProvider>,
  ) }
}

beforeEach(() => {
  mockedCancelTrip.mockReset()
  vi.mocked(listAuditPacks).mockReset().mockResolvedValue([])
  vi.mocked(listIncidentDeclarations).mockReset().mockResolvedValue([])
  vi.mocked(recordIncidentDeclaration).mockReset()
})

describe('TripDetailPanel Info audit section', () => {
  it('places audit packs after trip information, inside the same surface', async () => {
    renderPanel()

    const info = screen.getByRole('heading', { name: 'Custody' })
    const audit = screen.getByRole('region', { name: 'Audit packs' })
    expect(audit).toHaveAttribute('id', 'trip-audit-packs')
    expect(info.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Trip information' })).toContainElement(audit)
    expect(await within(audit).findByText('No audit packs issued for this trip yet.')).toBeInTheDocument()
  })

  it('offers exactly Info, Cargo and Exceptions in the dock', async () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ ...window.matchMedia(''), matches: true })
    try {
      renderPanel()
      await screen.findByText('No audit packs issued for this trip yet.')
      expect(screen.getAllByRole('tab')).toHaveLength(3)
      expect(screen.getByRole('tab', { name: 'Info' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Cargo' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /Exceptions/ })).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Audit packs' })).not.toBeInTheDocument()
    } finally { media.mockRestore() }
  })

  it.each(['manifest', 'exceptions'] as const)('does not render audit packs in %s', panel => {
    renderPanel(vi.fn(), trip, { panel })
    expect(screen.queryByRole('region', { name: 'Audit packs' })).not.toBeInTheDocument()
    expect(listAuditPacks).not.toHaveBeenCalled()
  })

  it('leaves Info usable while audit packs load', async () => {
    vi.mocked(listAuditPacks).mockReturnValue(new Promise(() => {}))
    renderPanel(vi.fn(), activeTrip)

    expect(screen.getByText('Loading audit packs…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))
    expect(screen.getByRole('dialog', { name: 'Cancel this trip?' })).toBeInTheDocument()
  })

  it.each([
    [403, 'Admin dispatcher role required.', 'Only admin dispatchers can see and issue audit packs.'],
    [503, 'Audit service unavailable.', 'Audit service unavailable.'],
  ])('keeps trip information when audit loading returns %s', async (status, error, message) => {
    vi.mocked(listAuditPacks).mockRejectedValue(new ApiError(Number(status), String(error)))
    renderPanel()

    expect(await screen.findByText(String(message))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Custody' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Route' })).toBeInTheDocument()
  })

  it('restores focus when an audit dialog is dismissed', async () => {
    renderPanel()
    const trigger = screen.getByRole('button', { name: 'Issue audit pack' })
    await userEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Issue audit pack' })
    expect(screen.getByRole('dialog', { name: 'Trip information' })).not.toContainElement(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('refreshes declarations without remounting Info or resetting the panel scroll, then focuses the new trigger', async () => {
    vi.mocked(recordIncidentDeclaration).mockResolvedValue({
      declaration_id: 'declaration-new', exception_id: null, saps_station: 'Test SAPS', saps_cas_number: null,
      saps_officer: null, reported_to_saps_at: null, tracking_company_notified_at: null, insurer_notified_at: null,
      client_notified_at: null, insurer_claim_reference: null, note: null, declared_by_name: 'Test Dispatcher',
      declared_at: '2026-10-13T10:00:00Z', tier: 'declared',
    })
    vi.mocked(listIncidentDeclarations).mockResolvedValueOnce([]).mockResolvedValue([{
      declaration_id: 'declaration-new', exception_id: null, saps_station: 'Test SAPS', saps_cas_number: 'TEST/2026',
      saps_officer: null, reported_to_saps_at: null, tracking_company_notified_at: null, insurer_notified_at: null,
      client_notified_at: null, insurer_claim_reference: null, note: null, declared_by_name: 'Test Dispatcher',
      declared_at: '2026-10-13T10:00:00Z', tier: 'declared',
    }])
    renderPanel()
    await screen.findByText('No audit packs issued for this trip yet.')
    const info = screen.getByRole('heading', { name: 'Custody' })
    const surface = screen.getByRole('dialog', { name: 'Trip information' })
    const audit = screen.getByRole('region', { name: 'Audit packs' })
    vi.spyOn(audit, 'getBoundingClientRect').mockReturnValue({
      top: 300, left: 0, bottom: 1100, right: 400, height: 800, width: 400, x: 0, y: 300, toJSON: () => ({}),
    })
    // Native browsers clamp scrollTop if a keyed reload temporarily shortens the list.
    vi.mocked(listAuditPacks).mockReturnValue(new Promise(() => {}))
    surface.scrollTop = 240
    const oldTrigger = screen.getByRole('button', { name: 'Record police details' })
    await userEvent.click(oldTrigger)
    const dialog = screen.getByRole('dialog', { name: 'Record police & notification details' })
    await userEvent.type(within(dialog).getByLabelText('SAPS station'), 'Test SAPS')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(await screen.findByText('CAS TEST/2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Custody' })).toBe(info)
    expect(audit).toHaveStyle({ minHeight: '800px' })
    expect(screen.getByText('Loading audit packs…')).toBeInTheDocument()
    expect(surface.scrollTop).toBe(240)
    expect(oldTrigger).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record police details' })).toHaveFocus())
  })
})

describe('TripDetailPanel precinct preview placement', () => {
  it('opens the precinct preview as a sibling of the overlay, not nested inside its dialog', async () => {
    // vitest.setup.ts defaults matchMedia to non-matching, which is the below-dock-width
    // path where DetailPanel wraps its children in its own <dialog> — the exact
    // condition that made a nested PrecinctModal centre on the wrong box.
    renderPanel()
    const stop = trip.stops[0]!
    const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
    const label = precinctLabel(precinct)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

    const overlayDialog = screen.getByRole('dialog', { name: 'Trip information' })
    const precinctDialog = screen.getByRole('dialog', { name: label })
    expect(overlayDialog.contains(precinctDialog)).toBe(false)
    expect(screen.getByRole('link', { name: 'View precinct' })).toHaveAttribute(
      'href', `/precincts/${precinct.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })
})

describe('TripDetailPanel exception badge', () => {
  it('does not inflate the exceptions tab badge when a polling merge repeats a record', async () => {
    const repeated = activeTrip.exceptions[0]
    if (!repeated) throw new Error('active trip exception fixture is missing')
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, media: '(min-width: 1280px)', onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })

    try {
      renderPanel(vi.fn(), { ...activeTrip, exceptions: [repeated, { ...repeated }] })
      await screen.findByText('No audit packs issued for this trip yet.')
      expect(screen.getByRole('tab', { name: 'Exceptions 1' })).toBeInTheDocument()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})

describe('TripDetailPanel cancellation dialog placement', () => {
  it('opens the cancellation dialog as a sibling of the overlay, not nested inside its dialog', async () => {
    // Same defect as the precinct preview above: below the dock width DetailPanel wraps
    // its children in its own <dialog>, and CancelTripAction's old uncontrolled Modal
    // nested inside that open overlay centred on the ancestor's box, not the viewport.
    renderPanel(vi.fn(), activeTrip)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))

    const overlayDialog = screen.getByRole('dialog', { name: 'Trip information' })
    const cancelDialog = screen.getByRole('dialog', { name: 'Cancel this trip?' })
    expect(overlayDialog.contains(cancelDialog)).toBe(false)
  })

  it('dismisses via "Keep trip active" without calling onChanged or the API, and returns focus to the trigger', async () => {
    const { onChanged } = renderPanel(vi.fn(), activeTrip)

    const trigger = screen.getByRole('button', { name: 'Cancel trip' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Keep trip active' }))

    expect(screen.queryByRole('dialog', { name: 'Cancel this trip?' })).not.toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    expect(mockedCancelTrip).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})


describe('TripDetailPanel exceptions tab', () => {
  const photo: EvidenceArtifactWithUrl = {
    id: 'art-panel' as ArtifactId, trip_id: 't', artifact_type: 'photo', s3_key: 'k', s3_bucket: 'b', file_hash: 'b'.repeat(64),
    mime_type: 'image/jpeg', captured_at: '2026-05-09T07:00:00Z', captured_by_driver_id: null, captured_by_user_id: null,
    captured_lat: null, captured_lng: null, created_at: '2026-05-09T07:00:01Z', phase_event_id: null, evidence_role: null,
    signed_url: 'https://storage.test/panel.jpg',
  }
  const withPhoto: TripException = { ...activeTrip.exceptions[0]!, id: 'with-photo' as TripException['id'], supporting_artifact_id: 'art-panel' }
  const scrollIntoView = vi.fn()

  function renderExceptions(extra: Partial<React.ComponentProps<typeof TripDetailPanel>>) {
    return render(
      <ToastProvider>
        <TripDetailPanel panel="exceptions" trip={{ ...activeTrip, exceptions: [withPhoto] }} precincts={mockPrecincts} filter="all"
          artifactsById={new Map([['art-panel', photo]])} overlayOpen onSelect={vi.fn()} onClose={vi.fn()} onFilter={vi.fn()}
          onChanged={vi.fn()} returnTo="/trips/trip-1" {...extra} />
      </ToastProvider>,
    )
  }

  it('hands the trip artifacts to the exception footer so the supporting photo resolves', () => {
    renderExceptions({})
    // The pane opens compact; the footer is on the full card.
    fireEvent.click(screen.getByRole('tab', { name: 'Detailed' }))

    expect(within(screen.getByText('Supporting evidence').closest('details')!).getByRole('img', { name: 'Supporting photo' })).toHaveAttribute('src', photo.signed_url)
  })

  it('passes the selected exception through and marks it', () => {
    Element.prototype.scrollIntoView = scrollIntoView

    renderExceptions({ selectedExceptionId: withPhoto.id })

    expect(document.querySelector(`[data-exception-id="${withPhoto.id}"]`)).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the Group by phase, Compact and sort choices when the dispatcher visits Info and comes back', () => {
    const view = renderExceptions({})
    const reopen = (panel: 'information' | 'exceptions') => view.rerender(
      <ToastProvider>
        <TripDetailPanel panel={panel} trip={{ ...activeTrip, exceptions: [withPhoto] }} precincts={mockPrecincts} filter="all"
          artifactsById={new Map([['art-panel', photo]])} overlayOpen onSelect={vi.fn()} onClose={vi.fn()} onFilter={vi.fn()}
          onChanged={vi.fn()} returnTo="/trips/trip-1" />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Group by phase' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Compact' }))
    fireEvent.click(screen.getByRole('button', { name: /reverse order/ }))
    reopen('information')
    reopen('exceptions')

    expect(screen.getByRole('switch', { name: 'Group by phase' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('tab', { name: 'Compact' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Oldest first, reverse order' })).toBeInTheDocument()
  })

  it('passes an unknown exception id through as the recoverable message', () => {
    const onClearExceptionSelection = vi.fn()

    renderExceptions({ invalidExceptionId: 'foreign', onClearExceptionSelection })

    screen.getByRole('button', { name: 'Show all exceptions' }).click()
    expect(onClearExceptionSelection).toHaveBeenCalledOnce()
  })
})
