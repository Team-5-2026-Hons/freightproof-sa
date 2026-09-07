import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ExceptionDetailPage from './page'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { resolveException, useExceptions } from '@/lib/hooks/useExceptions'
import type { TripException } from '@shared/lib/types/exception'

// client.ts imports the Supabase client at module scope, which throws without real env
// vars — mocked the same way lib/api/client.test.ts and CancelTripAction.test.tsx do.
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
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '11111111-1111-1111-1111-111111111111' }),
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useExceptions', () => ({
  useExceptions: vi.fn(),
  resolveException: vi.fn(),
}))

const mockedUseExceptions = vi.mocked(useExceptions)
const mockedResolve = vi.mocked(resolveException)

const OPEN_EXCEPTION: TripException = {
  id: '11111111-1111-1111-1111-111111111111' as TripException['id'],
  trip_id: '22222222-2222-2222-2222-222222222222',
  trip_reference: 'FP-2026-0001',
  exception_type: 'seal_mismatch',
  source: 'system',
  severity: 'critical',
  description: 'Seal at destination does not match departure.',
  phase_event_id: null,
  checkpoint_id: null,
  supporting_artifact_id: null,
  review_status: 'recorded',
  review_outcome: null,
  reviewed_by_user_id: null,
  reviewed_at: null,
  review_note: null,
  contact_method: null,
  merkle_batch_id: null,
  created_at: '2026-09-03T10:00:00Z',
  updated_at: '2026-09-03T10:00:00Z',
}

const NOTE = 'Phoned the depot; the seal was cut during a lawful SARS inspection.'

function renderPage() {
  render(
    // TripIdStamp in the related-trip banner reads forensic mode, so the page cannot
    // mount without it. Both providers are real rather than mocked — neither has any
    // bearing on what these tests assert, and faking them would only add a second thing
    // that could be wrong.
    <ForensicModeProvider>
      <ToastProvider>
        <ExceptionDetailPage />
      </ToastProvider>
    </ForensicModeProvider>,
  )
}

const submitButton = () => screen.getByRole('button', { name: 'Resolve' })
const noteField = () => screen.getByLabelText('Resolution note')
const methodField = () => screen.getByLabelText('How was this established?')

beforeEach(() => {
  push.mockReset()
  mockedResolve.mockReset().mockResolvedValue(OPEN_EXCEPTION)
  mockedUseExceptions.mockReturnValue({
    exceptions: [OPEN_EXCEPTION],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    refetchSilent: vi.fn(),
  })
})

describe('Exception detail — the resolution method is chosen, never assumed', () => {
  it('pre-selects no method', () => {
    // The field used to default to "Phoned the driver". A dispatcher who resolved from
    // evidence alone and never touched the select filed a record asserting they phoned
    // the driver — a call that did not happen, written onto the one artefact whose
    // entire purpose is to be true later. 'no_contact_yet' exists precisely so that
    // dispatcher has something honest to pick.
    renderPage()

    expect((methodField() as HTMLSelectElement).value).toBe('')
  })

  it('keeps the resolve control disabled until a method is deliberately chosen', () => {
    renderPage()

    fireEvent.change(noteField(), { target: { value: NOTE } })
    expect(submitButton()).toBeDisabled()

    fireEvent.change(methodField(), { target: { value: 'no_contact_yet' } })
    expect(submitButton()).toBeEnabled()
  })

  it('keeps the resolve control disabled while the note is empty', () => {
    // The existing rule, asserted alongside the new one so a later edit cannot satisfy
    // the method gate by dropping the note gate.
    renderPage()

    fireEvent.change(methodField(), { target: { value: 'phoned' } })
    expect(submitButton()).toBeDisabled()
  })

  it('submits the method the dispatcher picked', async () => {
    renderPage()

    fireEvent.change(noteField(), { target: { value: NOTE } })
    fireEvent.change(methodField(), { target: { value: 'whatsapp' } })
    fireEvent.click(submitButton())

    await waitFor(() =>
      expect(mockedResolve).toHaveBeenCalledWith(OPEN_EXCEPTION.id, {
        resolver_note: NOTE,
        resolution_method: 'whatsapp',
      }),
    )
  })
})
