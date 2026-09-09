import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ExceptionDetailPage from './page'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useExceptionDetail } from '@/lib/hooks/useExceptionDetail'
import { ApiError, reviewException } from '@/lib/api/client'
import type { TripException, TripExceptionDetail } from '@shared/lib/types/exception'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

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
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
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
  return { ...actual, reviewException: vi.fn() }
})

const mockedUseExceptionDetail = vi.mocked(useExceptionDetail)
const mockedReviewException = vi.mocked(reviewException)

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
    phase_label: null,
    stop_label: null,
    gps_lat: null,
    gps_lng: null,
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    trip_closed_at: null,
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
  merkle_batch_id: null,
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

const noteField    = () => screen.getByLabelText('Review note')
const outcomeField = () => screen.getByLabelText('Outcome')
const contactField = () => screen.getByLabelText('Contact method')
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
})

describe('Exception detail — loading and error states', () => {
  it('shows a spinner while loading', () => {
    mockDetail(null, { isLoading: true })
    renderPage()

    expect(screen.getByText('Exception Detail')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('shows one honest error state when the record could not be loaded, with a way back', () => {
    mockDetail(null, { error: 'Session expired. Please sign in again.' })
    renderPage()

    expect(screen.getByText('Session expired. Please sign in again.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Exceptions' }))
    expect(push).toHaveBeenCalledWith('/exceptions')
  })

  it('does not tear down a loaded record when a background refresh fails', () => {
    // useExceptionDetail refetches on realtime events for this trip; a failed background
    // refresh must not replace a half-typed review with an error page.
    mockDetail(baseException(), { error: 'Network error' })
    renderPage()

    expect(screen.getByLabelText('Review note')).toBeInTheDocument()
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

    expect(screen.getByText('In Transit · Stop 2')).toBeInTheDocument()
  })

  it('degrades cleanly with no literal "null" or dangling separator when phase/stop are absent', () => {
    mockDetail(baseException({ phase_label: null, stop_label: null }))
    renderPage()

    expect(screen.queryByText(/null/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^·/)).not.toBeInTheDocument()
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

    expect(screen.getByLabelText('Review note')).toBeInTheDocument()
  })

  it('shows a secondary "Add review" action for a recorded exception, form hidden until clicked', () => {
    mockDetail(baseException({ review_status: 'recorded' }))
    renderPage()

    expect(screen.queryByLabelText('Review note')).not.toBeInTheDocument()
    const addReview = screen.getByRole('button', { name: 'Add review' })
    expect(addReview).toBeInTheDocument()

    fireEvent.click(addReview)
    expect(screen.getByLabelText('Review note')).toBeInTheDocument()
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
    expect(screen.getByText('Already reviewed by a colleague')).toBeInTheDocument()
  })
})
