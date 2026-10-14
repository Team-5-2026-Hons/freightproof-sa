import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BatchReviewForm } from './BatchReviewForm'
import { ApiError, reviewExceptionBatch } from '@/lib/api/client'
import type { TripException } from '@shared/lib/types/exception'

// lib/api/client builds a Supabase client at import time, which throws without a URL.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const notify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify }) }))

// Keep ApiError real (the form's catch block uses instanceof); mock only the mutation.
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')
  return { ...actual, reviewExceptionBatch: vi.fn() }
})
const mockedBatch = vi.mocked(reviewExceptionBatch)

const TRIP_ID = 'trip-batch-1'

function warning(id: string, type: TripException['exception_type']): TripException {
  return {
    id: id as TripException['id'], trip_id: TRIP_ID, exception_type: type,
    source: 'system', severity: 'warning', description: `Warning ${id}`,
    phase_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    review_status: 'needs_review', review_outcome: null, reviewed_by_user_id: null,
    reviewed_at: null, review_note: null, contact_method: null, vehicle_id: null,
    merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null,
    claimed_by_name: null, reviewed_by_name: null,
    created_at: '2026-09-15T08:00:00Z', updated_at: '2026-09-15T08:00:00Z',
  }
}

const EXCEPTIONS = [warning('ex-1', 'cargo_damage'), warning('ex-2', 'gps_mismatch')]

function fillForm(): void {
  fireEvent.change(screen.getByLabelText('Review note (required)'), { target: { value: '  Looked at both  ' } })
  fireEvent.change(screen.getByLabelText('Outcome (required)'), { target: { value: 'no_action_required' } })
}

function renderForm(onDone = vi.fn(), onCancel = vi.fn()) {
  render(<BatchReviewForm tripId={TRIP_ID} exceptions={EXCEPTIONS} onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('BatchReviewForm', () => {
  beforeEach(() => { mockedBatch.mockReset(); notify.mockReset() })

  it('sends only the rows shown when it opened, even if a warning arrives while typing', async () => {
    mockedBatch.mockResolvedValue([])
    const onDone = vi.fn()
    const { rerender } = render(
      <BatchReviewForm tripId={TRIP_ID} exceptions={EXCEPTIONS} onDone={onDone} onCancel={vi.fn()} />,
    )

    rerender(
      <BatchReviewForm
        tripId={TRIP_ID} exceptions={[...EXCEPTIONS, warning('ex-late', 'cargo_damage')]}
        onDone={onDone} onCancel={vi.fn()}
      />,
    )
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /Review 2 exceptions/ }))

    await waitFor(() => expect(mockedBatch).toHaveBeenCalledTimes(1))
    expect(mockedBatch.mock.calls[0][0].exception_ids).toEqual(['ex-1', 'ex-2'])
  })

  it('lists each row it will review, one line per exception', () => {
    renderForm()

    expect(screen.getByText(/Cargo Damage/)).toBeInTheDocument()
    expect(screen.getByText(/GPS mismatch/)).toBeInTheDocument()
  })

  it('submits exactly the listed ids with one note and outcome', async () => {
    mockedBatch.mockResolvedValue([])
    const { onDone } = renderForm()

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /Review 2 exceptions/ }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(mockedBatch).toHaveBeenCalledWith({
      trip_id: TRIP_ID,
      exception_ids: ['ex-1', 'ex-2'],
      review_note: 'Looked at both',
      review_outcome: 'no_action_required',
      contact_method: null,
    })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', title: '2 exceptions reviewed' }))
  })

  it('blocks submit until note and outcome are set', () => {
    renderForm()
    const submit = screen.getByRole('button', { name: /Review 2 exceptions/ })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Review note (required)'), { target: { value: 'Note only' } })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Outcome (required)'), { target: { value: 'no_action_required' } })
    expect(submit).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Review note (required)'), { target: { value: '   ' } })
    expect(submit).toBeDisabled()
    expect(mockedBatch).not.toHaveBeenCalled()
  })

  it('stays open and toasts on 409', async () => {
    mockedBatch.mockRejectedValue(new ApiError(409, 'claimed'))
    const { onDone } = renderForm()

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /Review 2 exceptions/ }))

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title: 'A colleague got there first' })))
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Review note (required)')).toHaveValue('  Looked at both  ')
  })

  it("toasts the server's detail on 422", async () => {
    mockedBatch.mockRejectedValue(new ApiError(422, 'Batch review is for non-critical exceptions'))
    const { onDone } = renderForm()

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /Review 2 exceptions/ }))

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error', body: 'Batch review is for non-critical exceptions',
    })))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('calls onCancel from the cancel button', () => {
    const { onCancel } = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })
})
