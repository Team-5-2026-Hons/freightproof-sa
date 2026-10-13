import { render, screen, waitFor, within } from '@testing-library/react'
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

const mockedCancelTrip = vi.mocked(cancelTrip)

// Supporting photos in the exceptions tab resolve through this map; most tests here never open that tab.
const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

const trip = mockTrips[0]!
// mockTrips[0] is a closed trip (TRP-2026-0035), so its own "Cancel trip" trigger is
// correctly hidden — the cancellation-dialog tests below need a still-cancellable trip,
// with the same stops/precincts fixture data, to exercise the trigger and dialog.
const activeTrip = { ...trip, status: 'active' as const }

function renderPanel(onChanged = vi.fn(), tripOverride = trip) {
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
      />
    </ToastProvider>,
  ) }
}

beforeEach(() => {
  mockedCancelTrip.mockReset()
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
  it('does not inflate the exceptions tab badge when a polling merge repeats a record', () => {
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

    expect(within(screen.getByText('Supporting evidence').closest('details')!).getByRole('img', { name: 'Supporting photo' })).toHaveAttribute('src', photo.signed_url)
  })

  it('passes the selected exception through and marks it', () => {
    Element.prototype.scrollIntoView = scrollIntoView

    renderExceptions({ selectedExceptionId: withPhoto.id })

    expect(document.querySelector(`[data-exception-id="${withPhoto.id}"]`)).toHaveAttribute('aria-current', 'true')
  })

  it('passes an unknown exception id through as the recoverable message', () => {
    const onClearExceptionSelection = vi.fn()

    renderExceptions({ invalidExceptionId: 'foreign', onClearExceptionSelection })

    screen.getByRole('button', { name: 'Show all exceptions' }).click()
    expect(onClearExceptionSelection).toHaveBeenCalledOnce()
  })
})
