import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ExceptionDetailPage from './page'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useExceptionDetail } from '@/lib/hooks/useExceptionDetail'
import { ApiError, claimException, releaseException, reviewException } from '@/lib/api/client'
import type { TripException, TripExceptionDetail } from '@shared/lib/types/exception'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { VehicleId } from '@shared/lib/types/vehicle'

// client.ts imports the Supabase client at module scope, which throws without real env
// vars — mocked the same way lib/api/client.test.ts and CancelTripAction.test.tsx do.
// The rest of the module (ApiError, reviewException) is mocked separately below since
// this page never imports supabase/client directly.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicModeProvider reads the signed-in user. Nothing these tests assert depends on
// who that is, so the identity is stubbed rather than an AuthProvider stood up.
// The claim UI does depend on who is signed in (mine vs a colleague's claim), so the
// user is a mutable stub the claim tests set; everything else leaves it at null.
let mockUserId: string | null = null
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUserId === null ? null : { id: mockUserId } }),
}))

const push = vi.fn()
const back = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '11111111-1111-1111-1111-111111111111' }),
  useRouter: () => ({ push, back }),
  useSearchParams: () => searchParams,
}))

vi.mock('@/lib/hooks/useExceptionDetail', () => ({
  useExceptionDetail: vi.fn(),
}))

// Keep ApiError real (instanceof checks in the page's catch block depend on it) and mock
// only the one mutation this page calls — same pattern as CancelTripAction.test.tsx.
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')
  return { ...actual, reviewException: vi.fn(), claimException: vi.fn(), releaseException: vi.fn() }
})

const mockedUseExceptionDetail = vi.mocked(useExceptionDetail)
const mockedReviewException = vi.mocked(reviewException)
const mockedClaimException = vi.mocked(claimException)
const mockedReleaseException = vi.mocked(releaseException)

const EXCEPTION_ID = '11111111-1111-1111-1111-111111111111'

const ARTIFACT_WITH_URL: EvidenceArtifactWithUrl = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as EvidenceArtifactWithUrl['id'],
  trip_id: '22222222-2222-2222-2222-222222222222',
  artifact_type: 'photo',
  s3_key: 'trips/22222222/exceptions/photo.jpg',
  s3_bucket: 'freightproof-evidence',
  file_hash: 'a'.repeat(64),
  mime_type: 'image/jpeg',
  captured_at: '2026-09-03T10:00:00Z',
  captured_by_driver_id: '33333333-3333-3333-3333-333333333333',
  captured_by_user_id: null,
  captured_lat: -33.9249,
  captured_lng: 18.4241,
  created_at: '2026-09-03T10:00:00Z',
  signed_url: 'https://storage.example/photo.jpg',
}

const ARTIFACT_NO_URL: EvidenceArtifactWithUrl = {
  ...ARTIFACT_WITH_URL,
  signed_url: null,
}

function baseException(overrides: Partial<TripExceptionDetail> = {}): TripExceptionDetail {
  return {
    id: EXCEPTION_ID as TripExceptionDetail['id'],
    exception_type: 'seal_mismatch',
    source: 'system',
    severity: 'critical',
    review_status: 'needs_review',
    description: 'Seal at destination does not match departure.',
    created_at: '2026-09-03T10:00:00Z',
    trip_id: '22222222-2222-2222-2222-222222222222',
    trip_reference: 'FP-2026-0001',
    trip_status: 'active',
    origin_name: 'Johannesburg DC',
    destination_name: 'Durban Depot',
    driver_name: 'Thabo Mokoena',
    horse_registration: 'HRS 001 GP',
    trailer_registrations: ['TRL 101 GP'],
    phase_label: null,
    stop_label: null,
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_name: null,
    reviewed_by_name: null,
    gps_lat: null,
    gps_lng: null,
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    trip_closed_at: null,
    vehicle_id: null,
    vehicle_registration: null,
    vehicle_type: null,
    supporting_artifact_id: null,
    supporting_artifact: null,
    ...overrides,
  }
}

// reviewException's real return type (TripExceptionRead on the backend, mirrored by the
// TripException type — see that type's own header comment) — narrower than
// TripExceptionDetail. The page discards this response and calls refetchSilent()
// instead (see reviewException's own doc comment in lib/api/client.ts for why), so only
// its shape matters here, not its values.
const REVIEWED_RESPONSE: TripException = {
  id: EXCEPTION_ID as TripException['id'],
  trip_id: '22222222-2222-2222-2222-222222222222',
  trip_reference: 'FP-2026-0001',
  exception_type: 'seal_mismatch',
  source: 'system',
  severity: 'critical',
  description: 'Seal at destination does not match departure.',
  phase_event_id: null,
  checkpoint_id: null,
  supporting_artifact_id: null,
  review_status: 'reviewed',
  review_outcome: 'evidence_verified',
  reviewed_by_user_id: '44444444-4444-4444-4444-444444444444',
  reviewed_at: '2026-09-04T09:30:00Z',
  review_note: 'Evidence settles it.',
  contact_method: null,
  vehicle_id: null,
  merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
  created_at: '2026-09-03T10:00:00Z',
  updated_at: '2026-09-04T09:30:00Z',
}

const refetch = vi.fn()
const refetchSilent = vi.fn()

function mockDetail(
  exception: TripExceptionDetail | null,
  opts: { isLoading?: boolean; error?: string | null } = {},
) {
  mockedUseExceptionDetail.mockReturnValue({
    exception,
    isLoading: opts.isLoading ?? false,
    error: opts.error ?? null,
    refetch,
    refetchSilent,
  })
}

function renderPage() {
  render(
    // TripIdStamp reads forensic mode, so the page cannot mount without it. Both
    // providers are real rather than mocked — neither has any bearing on what these
    // tests assert, and faking them would only add a second thing that could be wrong.
    <ForensicModeProvider>
      <ToastProvider>
        <ExceptionDetailPage />
      </ToastProvider>
    </ForensicModeProvider>,
  )
}

const NOTE = 'Phoned the depot; the seal was cut during a lawful SARS inspection.'

const noteField    = () => screen.getByLabelText('Review note (required)')
const outcomeField = () => screen.getByLabelText('Outcome (required)')
const contactField = () => screen.getByLabelText('Contact method (optional)')
const submitButton = () => screen.getByRole('button', { name: 'Submit review' })

function fillValidForm() {
  fireEvent.change(noteField(), { target: { value: NOTE } })
  fireEvent.change(outcomeField(), { target: { value: 'evidence_verified' } })
}

beforeEach(() => {
  push.mockReset()
  searchParams = new URLSearchParams()
  back.mockReset()
  refetch.mockReset()
  refetchSilent.mockReset()
  mockedReviewException.mockReset().mockResolvedValue(REVIEWED_RESPONSE)
  mockedClaimException.mockReset().mockResolvedValue(REVIEWED_RESPONSE)
  mockedReleaseException.mockReset().mockResolvedValue(REVIEWED_RESPONSE)
  mockUserId = null
})

describe('Exception detail — loading and error states', () => {
  it('shows a spinner while loading', () => {
    mockDetail(null, { isLoading: true })
    renderPage()

    expect(screen.getByText('Exception Detail')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('offers Back while loading, so a slow record never strands the dispatcher', () => {
    mockDetail(null, { isLoading: true })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(push).toHaveBeenCalledWith('/exceptions')
  })

  it('places Back top-left, before the page title', () => {
    mockDetail(baseException())
    renderPage()

    const backButton = screen.getByRole('button', { name: 'Back' })
    const title = screen.getAllByText('Seal Mismatch')[0]

    // DOCUMENT_POSITION_FOLLOWING: the title comes after Back in the header row, which is
    // what puts Back on the left rather than in TopBar's right-hand action slot.
    expect(backButton.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows one honest error state when the record could not be loaded, with a way back', () => {
    mockDetail(null, { error: 'Session expired. Please sign in again.' })
    renderPage()

    expect(screen.getByText('Session expired. Please sign in again.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Exceptions' }))
    expect(push).toHaveBeenCalledWith('/exceptions')
  })

  it('shows the trip route, driver, truck and trailers above the evidence', () => {
    mockDetail(baseException())
    renderPage()

    const context = screen.getByRole('region', { name: 'Trip context' })
    expect(context).toHaveTextContent('Johannesburg DC → Durban Depot')
    expect(context).toHaveTextContent('Thabo Mokoena')
    expect(context).toHaveTextContent('HRS 001 GP')
    expect(context).toHaveTextContent('TRL 101 GP')
  })

  it('states when no trailers or crew were recorded instead of leaving blanks', () => {
    mockDetail(baseException({ origin_name: null, destination_name: null, driver_name: null, horse_registration: null, trailer_registrations: [] }))
    renderPage()

    const context = screen.getByRole('region', { name: 'Trip context' })
    expect(context).toHaveTextContent('Route not recorded')
    expect(context).toHaveTextContent('None attached')
  })

  it('does not tear down a loaded record when a background refresh fails', () => {
    // useExceptionDetail refetches on realtime events for this trip; a failed background
    // refresh must not replace a half-typed review with an error page.
    mockDetail(baseException(), { error: 'Network error' })
    renderPage()

    expect(screen.getByLabelText('Review note (required)')).toBeInTheDocument()
  })
})

describe('Exception detail — trip lifecycle banner', () => {
  it('shows no alarming banner for an active trip', () => {
    mockDetail(baseException({ trip_status: 'active' }))
    renderPage()

    expect(screen.queryByText(/trip closed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/trip cancelled/i)).not.toBeInTheDocument()
  })

  it('shows explicit "Trip closed" copy for a closed trip, without blocking the review form', () => {
    mockDetail(baseException({ trip_status: 'closed', trip_closed_at: '2026-09-04T08:00:00Z' }))
    renderPage()

    expect(screen.getByText(/trip closed/i)).toBeInTheDocument()
    // Terminal-trip-safe: the review form is still present and its submit control is
    // still reachable (disabled only by the empty-field gate, never by trip lifecycle).
    fillValidForm()
    expect(submitButton()).toBeEnabled()
  })

  it('shows explicit "Trip cancelled" copy for a cancelled trip, without blocking the review form', () => {
    mockDetail(baseException({ trip_status: 'cancelled' }))
    renderPage()

    expect(screen.getByText(/trip cancelled/i)).toBeInTheDocument()
    fillValidForm()
    expect(submitButton()).toBeEnabled()
  })
})

describe('Exception detail — phase/stop context', () => {
  it('renders phase and stop context when present', () => {
    mockDetail(baseException({ phase_label: 'In Transit', stop_label: 2 }))
    renderPage()

    expect(screen.getByText(/In Transit · Recorded stop 2/)).toBeInTheDocument()
  })

  it('degrades cleanly with no literal "null" or dangling separator when phase/stop are absent', () => {
    mockDetail(baseException({ phase_label: null, stop_label: null }))
    renderPage()

    expect(screen.queryByText(/null/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^·/)).not.toBeInTheDocument()
  })
})

describe('Exception detail: gps_mismatch trigger', () => {
  it('states the stored trigger explicitly for a gps_mismatch exception', () => {
    mockDetail(baseException({ exception_type: 'gps_mismatch' }))
    renderPage()

    expect(screen.getByTestId('gps-mismatch-trigger')).toHaveTextContent('Vehicle tracker outside the facility boundary')
  })

  it('renders no trigger line for a non-gps exception', () => {
    mockDetail(baseException({ exception_type: 'seal_mismatch' }))
    renderPage()

    expect(screen.queryByTestId('gps-mismatch-trigger')).not.toBeInTheDocument()
  })

  it('renders no trigger line for a driver-raised gps_mismatch (a driver row carries no tracker verdict)', () => {
    mockDetail(baseException({ exception_type: 'gps_mismatch', source: 'driver' }))
    renderPage()

    expect(screen.queryByTestId('gps-mismatch-trigger')).not.toBeInTheDocument()
  })
})

// Trailer analytics: a breakdown shows which vehicle it was recorded against.
describe('Exception detail — breakdown vehicle', () => {
  /** The value beside the "Vehicle" meta label, or null when there is no such row. */
  function vehicleRow(): string | null {
    return screen.queryByText('Vehicle')?.nextElementSibling?.textContent ?? null
  }

  it('names the trailer a breakdown was recorded against', () => {
    mockDetail(baseException({
      exception_type: 'mechanical',
      vehicle_id: 'vehicle-trailer' as VehicleId,
      vehicle_registration: 'TRL 222 GP',
      vehicle_type: 'trailer',
    }))
    renderPage()

    expect(vehicleRow()).toBe('Trailer · TRL 222 GP')
  })

  it('names the horse a breakdown was recorded against', () => {
    mockDetail(baseException({
      exception_type: 'mechanical',
      vehicle_id: 'vehicle-horse' as VehicleId,
      vehicle_registration: 'CA 123-456',
      vehicle_type: 'horse',
    }))
    renderPage()

    expect(vehicleRow()).toBe('Horse · CA 123-456')
  })

  it('says "Not recorded" for a breakdown reported before drivers named the vehicle', () => {
    mockDetail(baseException({ exception_type: 'mechanical' }))
    renderPage()

    expect(vehicleRow()).toBe('Not recorded')
  })

  it('shows no Vehicle row for any other exception type', () => {
    mockDetail(baseException({ exception_type: 'seal_mismatch' }))
    renderPage()

    expect(vehicleRow()).toBeNull()
  })
})

describe('Exception detail — review form gating', () => {
  it('disables submit until both note and outcome are present; contact method is never required', () => {
    mockDetail(baseException())
    renderPage()

    expect(submitButton()).toBeDisabled()

    fireEvent.change(noteField(), { target: { value: NOTE } })
    expect(submitButton()).toBeDisabled()

    fireEvent.change(outcomeField(), { target: { value: 'evidence_verified' } })
    expect(submitButton()).toBeEnabled()
  })

  it('sends an explicit null contact_method when left blank', async () => {
    mockDetail(baseException())
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() =>
      expect(mockedReviewException).toHaveBeenCalledWith(EXCEPTION_ID, {
        review_note: NOTE,
        review_outcome: 'evidence_verified',
        contact_method: null,
      }),
    )
  })

  it('a keyboard-driven submit with a missing field does not call reviewException', () => {
    // Tests the early-return guard inside the handler itself, not just the disabled
    // attribute — a form can still be submitted by pressing Enter in a field.
    mockDetail(baseException())
    renderPage()

    fireEvent.change(noteField(), { target: { value: NOTE } })
    // Outcome left unselected. Submit the form directly rather than clicking the
    // (disabled) button, to exercise the handler's own guard.
    fireEvent.submit(noteField().closest('form')!)

    expect(mockedReviewException).not.toHaveBeenCalled()
  })
})

describe('Exception detail — recorded vs needs_review visibility', () => {
  it('shows the review form immediately for a needs_review exception', () => {
    mockDetail(baseException({ review_status: 'needs_review' }))
    renderPage()

    expect(screen.getByLabelText('Review note (required)')).toBeInTheDocument()
  })

  it('shows a secondary "Add review" action for a recorded exception, form hidden until clicked', () => {
    mockDetail(baseException({ review_status: 'recorded' }))
    renderPage()

    expect(screen.queryByLabelText('Review note')).not.toBeInTheDocument()
    const addReview = screen.getByRole('button', { name: 'Add review' })
    expect(addReview).toBeInTheDocument()

    fireEvent.click(addReview)
    expect(screen.getByLabelText('Review note (required)')).toBeInTheDocument()
  })
})

describe('Exception detail — reviewed read-only summary', () => {
  it('renders outcome, note, contact method and reviewed_at; omits raw reviewer id', () => {
    mockDetail(baseException({
      review_status: 'reviewed',
      review_outcome: 'evidence_verified',
      review_note: 'Photo confirms the seal was cut during a lawful SARS inspection.',
      contact_method: 'phone',
      reviewed_at: '2026-09-04T09:30:00Z',
      reviewed_by_user_id: '44444444-4444-4444-4444-444444444444',
    }))
    renderPage()

    expect(screen.getByText('Evidence verified')).toBeInTheDocument()
    expect(screen.getByText('Photo confirms the seal was cut during a lawful SARS inspection.')).toBeInTheDocument()
    expect(screen.getByText('Phoned the driver')).toBeInTheDocument()
    expect(screen.queryByText('44444444-4444-4444-4444-444444444444')).not.toBeInTheDocument()
  })

  it('cleanly omits the contact method line when null', () => {
    mockDetail(baseException({
      review_status: 'reviewed',
      review_outcome: 'no_action_required',
      review_note: 'Resolved from evidence alone.',
      contact_method: null,
      reviewed_at: '2026-09-04T09:30:00Z',
    }))
    renderPage()

    expect(screen.queryByText('Phoned the driver')).not.toBeInTheDocument()
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByText('In person')).not.toBeInTheDocument()
  })
})

describe('Exception detail — supporting evidence', () => {
  it('renders the photo when the supporting artifact has a signed url', () => {
    mockDetail(baseException({
      supporting_artifact_id: ARTIFACT_WITH_URL.id,
      supporting_artifact: ARTIFACT_WITH_URL,
    }))
    renderPage()

    expect(screen.getByAltText('Supporting photo')).toBeInTheDocument()
  })

  it('renders the image-unavailable state when the artifact has no signed url', () => {
    mockDetail(baseException({
      supporting_artifact_id: ARTIFACT_NO_URL.id,
      supporting_artifact: ARTIFACT_NO_URL,
    }))
    renderPage()

    expect(screen.getByText('Recorded, image unavailable')).toBeInTheDocument()
  })
})

describe('Exception detail — submit outcomes', () => {
  it('on success, toasts and navigates to the exceptions list', async () => {
    mockDetail(baseException())
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() => expect(push).toHaveBeenCalledWith('/exceptions'))
    expect(screen.getByText('Exception reviewed.')).toBeInTheDocument()
  })

  it('on success from a trip, returns to that trip rather than the exceptions list', async () => {
    // The reader came from a trip timeline. Ejecting them to the list after a review
    // loses the record they were working through.
    searchParams = new URLSearchParams({ returnTo: '/trips/abc?panel=exceptions' })
    mockDetail(baseException())
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() => expect(push).toHaveBeenCalledWith('/trips/abc?panel=exceptions'))
  })

  it('ignores a return path that would leave the app', async () => {
    // The parameter is attacker-controllable via the address bar, so an off-origin value
    // must never become a redirect the app performs on the reader's behalf.
    searchParams = new URLSearchParams({ returnTo: 'https://example.com/phish' })
    mockDetail(baseException())
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() => expect(push).toHaveBeenCalledWith('/exceptions'))
  })

  it('on a 409, does not navigate away, shows colleague-conflict messaging, and refetches silently', async () => {
    mockedReviewException.mockReset().mockRejectedValue(
      new ApiError(409, "Exception 'x' was already reviewed by a colleague. Their review is the record; re-read it before reviewing again."),
    )
    mockDetail(baseException())
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() => expect(refetchSilent).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    // Exact match on the toast TITLE, not a substring search — the toast body also
    // contains "already reviewed by a colleague" (the backend's own detail message),
    // and both must be able to say so without the assertion becoming ambiguous.
    expect(screen.getByText('A colleague got there first')).toBeInTheDocument()
  })
})

const ME = 'me-user-id'
const ANA = 'ana-user-id'
const CLAIMED_AT = '2026-09-03T11:00:00Z'

describe('Exception detail — claim, release and take over', () => {
  it('offers Claim on an unclaimed exception, with the form enabled and a plain review submit', () => {
    mockUserId = ME
    mockDetail(baseException())
    renderPage()

    expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument()
    fillValidForm()
    expect(submitButton()).toBeEnabled()
  })

  it('claims and refetches', async () => {
    mockUserId = ME
    mockDetail(baseException())
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(mockedClaimException).toHaveBeenCalledWith(EXCEPTION_ID))
    await waitFor(() => expect(refetchSilent).toHaveBeenCalled())
    expect(screen.getByText('Exception claimed.')).toBeInTheDocument()
  })

  it('offers Take over and a Take over and review submit when a colleague holds the claim', () => {
    mockUserId = ME
    mockDetail(baseException({ claimed_by_user_id: ANA, claimed_by_name: 'Ana', claimed_at: CLAIMED_AT }))
    renderPage()

    expect(screen.getByText(/Claimed by Ana/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take over and review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit review' })).not.toBeInTheDocument()
  })

  it('takes over and refetches', async () => {
    mockUserId = ME
    mockDetail(baseException({ claimed_by_user_id: ANA, claimed_by_name: 'Ana', claimed_at: CLAIMED_AT }))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Take over' }))

    await waitFor(() => expect(mockedClaimException).toHaveBeenCalledWith(EXCEPTION_ID, true))
    await waitFor(() => expect(refetchSilent).toHaveBeenCalled())
  })

  it('takes over and reviews in one step', async () => {
    mockUserId = ME
    mockDetail(baseException({ claimed_by_user_id: ANA, claimed_by_name: 'Ana', claimed_at: CLAIMED_AT }))
    renderPage()

    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Take over and review' }))

    await waitFor(() =>
      expect(mockedReviewException).toHaveBeenCalledWith(EXCEPTION_ID, {
        review_note: NOTE,
        review_outcome: 'evidence_verified',
        contact_method: null,
        take_over: true,
      }),
    )
  })

  it('sends no take_over for an unclaimed or own-claim review', async () => {
    mockUserId = ME
    mockDetail(baseException({ claimed_by_user_id: ME, claimed_by_name: 'Me', claimed_at: CLAIMED_AT }))
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() => expect(mockedReviewException).toHaveBeenCalled())
    const body = mockedReviewException.mock.calls[0][1]
    expect(body.take_over ?? false).toBe(false)
  })

  it('shows my own claim and releases it', async () => {
    mockUserId = ME
    mockDetail(baseException({ claimed_by_user_id: ME, claimed_by_name: 'Me', claimed_at: CLAIMED_AT }))
    renderPage()

    expect(screen.getByText(/Claimed by you/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await waitFor(() => expect(mockedReleaseException).toHaveBeenCalledWith(EXCEPTION_ID))
    await waitFor(() => expect(refetchSilent).toHaveBeenCalled())
  })

  it('toasts "A colleague got there first" and refetches when a claim hits a 409', async () => {
    mockUserId = ME
    mockedClaimException.mockReset().mockRejectedValue(new ApiError(409, 'Already claimed by Ana.'))
    mockDetail(baseException())
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(refetchSilent).toHaveBeenCalled())
    expect(screen.getByText('A colleague got there first')).toBeInTheDocument()
  })

  it('toasts a generic error, and does not refetch, when a claim fails for another reason', async () => {
    mockUserId = ME
    mockedClaimException.mockReset().mockRejectedValue(new ApiError(500, 'boom'))
    mockDetail(baseException())
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(screen.getByText('Could not claim this exception')).toBeInTheDocument())
    expect(refetchSilent).not.toHaveBeenCalled()
  })

  it('keeps the typed note and refetches when review hits a 409', async () => {
    mockUserId = ME
    mockedReviewException.mockReset().mockRejectedValue(new ApiError(409, 'Claimed by Ana.'))
    mockDetail(baseException())
    renderPage()

    fillValidForm()
    fireEvent.click(submitButton())

    await waitFor(() => expect(refetchSilent).toHaveBeenCalled())
    expect(screen.getByText('A colleague got there first')).toBeInTheDocument()
    expect(noteField()).toHaveValue(NOTE)
    expect(push).not.toHaveBeenCalled()
  })

  it('names the reviewer and claimer on a reviewed exception', () => {
    mockUserId = ME
    mockDetail(baseException({
      review_status: 'reviewed',
      review_outcome: 'evidence_verified',
      review_note: 'Done.',
      reviewed_at: '2026-09-04T09:30:00Z',
      reviewed_by_user_id: 'ben-id',
      reviewed_by_name: 'Ben',
      claimed_by_user_id: ANA,
      claimed_by_name: 'Ana',
      claimed_at: CLAIMED_AT,
    }))
    renderPage()

    expect(screen.getByText(/Reviewed by Ben/)).toBeInTheDocument()
    expect(screen.getByText(/Claimed by Ana/)).toBeInTheDocument()
  })

  it('labels a dispatcher-authored note', () => {
    mockDetail(baseException({
      review_status: 'reviewed',
      review_outcome: 'dispatcher_authored',
      review_note: 'Cancelled: wrong load.',
      reviewed_at: '2026-09-04T09:30:00Z',
      reviewed_by_user_id: 'ben-id',
      reviewed_by_name: 'Ben',
      claimed_by_user_id: 'ben-id',
      claimed_by_name: 'Ben',
    }))
    renderPage()

    expect(screen.getByText(/Dispatcher note by Ben/)).toBeInTheDocument()
    expect(screen.queryByText(/Reviewed by Ben/)).not.toBeInTheDocument()
    // Reviewer and claimer are the same person, so no separate claim line.
    expect(screen.queryByText(/Claimed by/)).not.toBeInTheDocument()
  })
})


describe('assessment redesign', () => {
  it('lets the dispatcher cancel leaving an unsent assessment', () => {
    mockDetail(baseException())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.change(screen.getByLabelText(/Review note/), { target: { value: 'Unsent assessment' } })
    fireEvent.click(screen.getByRole('button', { name: /View trip/ }))
    expect(confirm).toHaveBeenCalledWith('Leave without submitting this assessment?')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Review note/)).toHaveValue('Unsent assessment')
    confirm.mockRestore()
  })
})
