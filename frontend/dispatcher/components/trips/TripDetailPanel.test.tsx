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
import type { AsyncState } from '@/lib/hooks/useAsyncData'
import type { IncidentSummary } from '@/lib/types/incident'

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
        incidents={incidentState}
        {...extra}
      />
    </ToastProvider>,
  ) }
}

// The page reads the trip's incidents once and hands them down; each test says what it hands.
let incidentState: AsyncState<IncidentSummary[]>
function incidents(data: IncidentSummary[], isLoading = false) {
  incidentState = { data, isLoading, error: null, refetch: vi.fn(), refetchSilent: vi.fn() }
}

beforeEach(() => {
  incidents([])
  mockedCancelTrip.mockReset()
  vi.mocked(listAuditPacks).mockReset().mockResolvedValue([])
  vi.mocked(listIncidentDeclarations).mockReset().mockResolvedValue([])
  vi.mocked(recordIncidentDeclaration).mockReset()
})

describe('TripDetailPanel Info audit section', () => {
  it('places audit packs after trip information, inside the same surface', async () => {
    renderPanel()

    const info = screen.getByRole('heading', { name: 'Schedule & seal' })
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

    expect(screen.getByRole('status', { name: 'Loading audit packs' })).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Schedule & seal' })).toBeInTheDocument()
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

  it('refreshes police details without remounting Info or resetting the panel scroll, then returns focus to the trigger', async () => {
    incidents([{ incident_id: 'i1', status: 'open', reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary])
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
    const info = screen.getByRole('heading', { name: 'Schedule & seal' })
    const surface = screen.getByRole('dialog', { name: 'Trip information' })
    surface.scrollTop = 240
    const oldTrigger = screen.getByRole('button', { name: 'Record police details' })
    await userEvent.click(oldTrigger)
    const dialog = screen.getByRole('dialog', { name: 'Record police & notification details' })
    await userEvent.type(within(dialog).getByLabelText('SAPS station'), 'Test SAPS')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(await screen.findByText('CAS TEST/2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Schedule & seal' })).toBe(info)
    expect(surface.scrollTop).toBe(240)
    // Police details are read again in place: the audit list is not reloaded and the button is the same element.
    expect(listAuditPacks).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Record police details' })).toBe(oldTrigger)
    await waitFor(() => expect(oldTrigger).toHaveFocus())
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
          onChanged={vi.fn()} returnTo="/trips/trip-1" incidents={incidentState} {...extra} />
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
          onChanged={vi.fn()} returnTo="/trips/trip-1" incidents={incidentState} />
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

describe('TripDetailPanel tab help', () => {
  it.each([
    ['information', 'About the Info tab', 'What the Info tab holds'],
    ['manifest', 'About the Cargo tab', 'What the Cargo tab shows'],
    ['exceptions', 'About the Exceptions tab', 'What the Exceptions tab shows'],
  ] as const)('%s tab: a help button opens its explanation', async (panel, label, question) => {
    renderPanel(vi.fn(), trip, { panel })

    await userEvent.click(screen.getByRole('button', { name: label }))

    expect(screen.getByRole('region', { name: label })).toHaveTextContent(question)
  })

  it('shows only the help for the tab that is open', () => {
    renderPanel(vi.fn(), trip, { panel: 'manifest' })

    expect(screen.queryByRole('button', { name: 'About the Info tab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'About the Exceptions tab' })).not.toBeInTheDocument()
  })

  it('adds no row of its own: the icon sits in the panel padding above the content', () => {
    renderPanel(vi.fn(), trip, { panel: 'information' })

    const anchor = screen.getByRole('button', { name: 'About the Info tab' }).closest('[data-keep-exception-selection]')!

    // A zero-height row, with the icon lifted into the padding, so the content starts where it did before the help existed.
    expect(anchor.parentElement!.className).toContain('h-0')
    expect(anchor.className).toContain('absolute')
    expect(anchor.className).toContain('-top-[22px]')
    // The 14px glyph sits 5px inside its 24px button, so the button overhangs the padding by that much to put the glyph on the content's right edge.
    expect(anchor.className).toContain('-right-[5px]')
  })
})

describe('TripDetailPanel Info sections', () => {
  beforeEach(() => localStorage.clear())

  it('shows five collapsible sections in order, then Trip actions on a live trip', async () => {
    renderPanel(vi.fn(), activeTrip)
    await screen.findByText('No audit packs issued for this trip yet.')

    const titles = ['Schedule & seal', 'Route', 'Driver & custody', 'Incidents', 'Audit packs'].map(name => screen.getByRole('heading', { name }))
    titles.slice(1).forEach((heading, i) => expect(titles[i]!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
    const actions = screen.getByRole('heading', { name: 'Trip actions' })
    expect(titles.at(-1)!.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Custody' })).not.toBeInTheDocument()
  })

  it('puts a filled, full-width Cancel trip button at the bottom', async () => {
    renderPanel(vi.fn(), activeTrip)

    const cancel = screen.getByRole('button', { name: 'Cancel trip' })

    expect(cancel).toHaveClass('w-full', 'bg-err')
    expect(screen.getByRole('region', { name: 'Trip actions' })).toContainElement(cancel)
  })

  it.each(['closed', 'cancelled'] as const)('has no Trip actions on a %s trip', status => {
    renderPanel(vi.fn(), { ...trip, status })

    expect(screen.queryByRole('heading', { name: 'Trip actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel trip' })).not.toBeInTheDocument()
  })

  it('opens only Schedule & seal when nothing needs attention, each section with a summary line', () => {
    renderPanel(vi.fn(), { ...activeTrip, pending_driver_substitution: null })

    const open = (name: string) => (screen.getByRole('heading', { name }).closest('details') as HTMLDetailsElement).open
    expect(open('Schedule & seal')).toBe(true)
    for (const name of ['Route', 'Driver & custody', 'Incidents', 'Audit packs']) expect(open(name)).toBe(false)
    expect(screen.getByRole('heading', { name: 'Incidents' }).closest('details')).toHaveTextContent('None')
    expect(screen.getByRole('heading', { name: 'Audit packs' }).closest('details')).toHaveTextContent('For insurers, clients and SAPS')
    // Grey text, not a chip, while all is quiet.
    expect(within(screen.getByRole('heading', { name: 'Incidents' }).closest('details')!).queryByText('None')!.className).not.toMatch(/bg-/)
  })

  it.each(['open', 'investigating'] as const)('opens Incidents and puts a chip in the summary while an incident is %s', status => {
    incidents([{ incident_id: 'i1', status, reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary])
    renderPanel()

    const section = screen.getByRole('heading', { name: 'Incidents' }).closest('details') as HTMLDetailsElement
    expect(section.open).toBe(true)
    // The chip wears the incident's own status colour (amber for open, blue for investigating), never a third.
    expect(within(section).getByText(`1 ${status}`).className).toMatch(status === 'open' ? /bg-warn-c/ : /bg-sec-c/)
  })

  it('leaves Incidents folded, with plain text, when every incident is closed', () => {
    incidents([{ incident_id: 'i1', status: 'closed', reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary])
    renderPanel()

    const section = screen.getByRole('heading', { name: 'Incidents' }).closest('details') as HTMLDetailsElement
    expect(section.open).toBe(false)
    expect(within(section).getByText('1 closed').className).not.toMatch(/bg-/)
  })

  it('shows the chip even when the reader folded Incidents away on another trip', () => {
    localStorage.setItem('fp.tripInfo.section.incidents', '0')
    incidents([{ incident_id: 'i1', status: 'investigating', reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary])
    renderPanel()

    const section = screen.getByRole('heading', { name: 'Incidents' }).closest('details') as HTMLDetailsElement
    expect(section.open).toBe(false)
    expect(within(section).getByText('1 investigating').className).toMatch(/bg-/)
  })

  it('opens Driver & custody and chips "Transfer pending" while a transfer is pending', () => {
    const pending = { id: 'p', state: 'pending', outgoing: { full_name: 'A' }, incoming: { full_name: 'B' } } as unknown as NonNullable<typeof activeTrip.pending_driver_substitution>
    renderPanel(vi.fn(), { ...activeTrip, pending_driver_substitution: pending })

    const custody = screen.getByRole('heading', { name: 'Driver & custody' }).closest('details') as HTMLDetailsElement
    expect(custody.open).toBe(true)
    expect(within(custody).getByText('Transfer pending', { selector: 'span' }).className).toMatch(/bg-/)
  })

  it('keeps police details under Incidents, not under Audit packs', async () => {
    incidents([{ incident_id: 'i1', status: 'open', reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary])
    renderPanel()

    const police = await screen.findByRole('region', { name: 'Police and notifications' })

    expect(screen.getByRole('heading', { name: 'Incidents' }).closest('details')).toContainElement(police)
    expect(screen.getByRole('heading', { name: 'Audit packs' }).closest('details')).not.toContainElement(police)
  })

  it('remembers a section the dispatcher opens across a remount', async () => {
    const first = renderPanel()
    await userEvent.click(screen.getByRole('heading', { name: 'Route' }))
    expect((screen.getByRole('heading', { name: 'Route' }).closest('details') as HTMLDetailsElement).open).toBe(true)
    first.unmount()

    renderPanel()

    expect((screen.getByRole('heading', { name: 'Route' }).closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('opens Audit packs for a legacy audit landing, however it was left', () => {
    localStorage.setItem('fp.tripInfo.section.audit', '0')

    renderPanel(vi.fn(), trip, { scrollToAuditPacks: true })

    expect((screen.getByRole('heading', { name: 'Audit packs' }).closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('lets the reader fold Audit packs away after a legacy landing, with no space left behind', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    try {
      renderPanel(vi.fn(), trip, { scrollToAuditPacks: true })
      const section = screen.getByRole('region', { name: 'Audit packs' })
      const details = section.querySelector('details') as HTMLDetailsElement
      expect(details.open).toBe(true)

      // The space reserved so the scroll can land is released once it has.
      await waitFor(() => expect(section.style.minHeight).toBe(''))
      await userEvent.click(screen.getByRole('heading', { name: 'Audit packs' }))

      expect(details.open).toBe(false)
      expect(section.style.minHeight).toBe('')
    } finally { height.mockRestore() }
  })

  it('does not force Audit packs open again after the reader folded it, while the landing URL stays', async () => {
    const { rerender, onChanged } = renderPanel(vi.fn(), trip, { scrollToAuditPacks: true })
    await userEvent.click(screen.getByRole('heading', { name: 'Audit packs' }))
    const details = screen.getByRole('region', { name: 'Audit packs' }).querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)

    rerender(<ToastProvider><TripDetailPanel panel="information" trip={trip} precincts={mockPrecincts} filter="needs_review" artifactsById={NO_ARTIFACTS}
      overlayOpen scrollToAuditPacks onSelect={vi.fn()} onClose={vi.fn()} onFilter={vi.fn()} onChanged={onChanged} returnTo="/trips/trip-1" incidents={incidentState} /></ToastProvider>)

    expect(details.open).toBe(false)
  })

  it('hands a completed handover row to the page, which owns the evidence modal', async () => {
    const { substitutionFixturePack } = await import('@shared/lib/mocks/driver-substitutions')
    const onOpenTransfer = vi.fn()
    renderPanel(vi.fn(), { ...activeTrip, pending_driver_substitution: null, driver_substitutions: [substitutionFixturePack.normalCompleted] }, { onOpenTransfer })

    await userEvent.click(screen.getByRole('button', { name: /View evidence/ }))

    expect(onOpenTransfer).toHaveBeenCalledExactlyOnceWith(substitutionFixturePack.normalCompleted.completed_substitution_id)
  })

  it('shows no police block on a trip with no incident', async () => {
    renderPanel()
    await screen.findByText('No audit packs issued for this trip yet.')

    expect(screen.queryByRole('region', { name: 'Police and notifications' })).not.toBeInTheDocument()
  })

  describe('police details and the fact sheet', () => {
    const withSeverity = (severity: TripException['severity'] | null) => ({
      ...activeTrip,
      exceptions: severity ? [{ ...activeTrip.exceptions[0]!, severity }] : [],
    })
    const OPEN_INCIDENT = { incident_id: 'i1', status: 'open', reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary

    it('shows the section and the fact sheet for a critical exception with no incident record', async () => {
      renderPanel(vi.fn(), withSeverity('critical'))

      expect(await screen.findByRole('region', { name: 'Police and notifications' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Incident fact sheet' })).toBeInTheDocument()
    })

    it('offers the fact sheet for a recorded hijacking without a critical exception', async () => {
      // A hijacking reported by phone never raised a panic; the server still builds its sheet.
      incidents([OPEN_INCIDENT])
      renderPanel(vi.fn(), withSeverity('warning'))

      expect(await screen.findByRole('button', { name: 'Incident fact sheet' })).toBeInTheDocument()
    })

    it('hides the fact sheet for a shortage record without a critical exception', async () => {
      incidents([{ ...OPEN_INCIDENT, incident_type: 'parcel_shortage' } as IncidentSummary])
      renderPanel(vi.fn(), withSeverity('warning'))

      expect(await screen.findByRole('button', { name: 'Record police details' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Incident fact sheet' })).not.toBeInTheDocument()
    })

    it('hides the whole section with neither an incident nor a critical exception', async () => {
      renderPanel(vi.fn(), withSeverity('warning'))
      await screen.findByText('No audit packs issued for this trip yet.')

      expect(screen.queryByRole('region', { name: 'Police and notifications' })).not.toBeInTheDocument()
    })
  })
})

describe('TripDetailPanel incidents summary chip', () => {
  const incidentWith = (status: string) => ({ incident_id: 'i1', status, reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary)

  it.each([['investigating', 'bg-sec-c'], ['open', 'bg-warn-c']])('colours_the_%s_summary_like_its_own_status_chip', (status, fill) => {
    window.localStorage.setItem('fp.tripInfo.section.incidents', '0')
    incidents([incidentWith(status)])
    try {
      renderPanel(vi.fn(), activeTrip)

      expect(screen.getByText(new RegExp(`1 ${status}`))).toHaveClass(fill)
    } finally { window.localStorage.removeItem('fp.tripInfo.section.incidents') }
  })
})

describe('TripDetailPanel incident focus', () => {
  const CLOSED_INCIDENT = { incident_id: 'i1', status: 'closed', reference: 'INC1', incident_type: 'hijacking', parcels_total: 0, parcels_unresolved: 0, exception_ids: [] } as unknown as IncidentSummary

  it('opens_the_folded_incidents_section_and_lands_on_the_incident_the_timeline_named', async () => {
    window.localStorage.setItem('fp.tripInfo.section.incidents', '0')
    incidents([CLOSED_INCIDENT])
    try {
      renderPanel(vi.fn(), activeTrip, { focusIncident: { incidentId: 'i1', requestId: 1 } })

      const row = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-incident-row="i1"]')
        expect(found).not.toBeNull()
        expect(found).toHaveFocus()
        return found!
      })
      expect(row.closest('details')).toHaveAttribute('open')
      expect(row).toHaveClass('ring-2')
      expect(within(row).getByRole('link', { name: 'View incident INC1' })).toBeInTheDocument()
    } finally { window.localStorage.removeItem('fp.tripInfo.section.incidents') }
  })

  it('does_nothing_when_no_incident_was_asked_for', () => {
    incidents([CLOSED_INCIDENT])
    renderPanel(vi.fn(), activeTrip)

    expect(document.querySelector('[data-incident-row="i1"]')).not.toHaveFocus()
  })
})
