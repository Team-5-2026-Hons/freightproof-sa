import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PhaseExceptionGroup } from './PhaseExceptionGroup'
import type { TripException } from '@shared/lib/types/exception'
import { reviewException } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ reviewException: vi.fn() }))
const mockedReviewException = vi.mocked(reviewException)

const phaseId = 'phase-loading-1'

function exception(id: string, reviewStatus: TripException['review_status']): TripException {
  return {
    id: id as TripException['id'], trip_id: 'trip-1', exception_type: 'cargo_damage',
    source: 'driver', severity: 'warning', description: `Recorded exception ${id}`,
    phase_event_id: phaseId, checkpoint_id: null, supporting_artifact_id: null,
    review_status: reviewStatus, review_outcome: null, reviewed_by_user_id: null,
    reviewed_at: null, review_note: null, contact_method: null, vehicle_id: null,
    merkle_batch_id: null, created_at: '2026-09-15T08:00:00Z', updated_at: '2026-09-15T08:00:00Z',
  }
}

describe('PhaseExceptionGroup', () => {
  it('starts collapsed and toggles its unique exception cards without reviewing either record', () => {
    mockedReviewException.mockReset()
    const onOpenPanel = vi.fn()
    const first = exception('exception-1', 'needs_review')
    const second = exception('exception-2', 'recorded')

    render(
      <PhaseExceptionGroup phaseId={phaseId} exceptions={[first, second]} onOpenPanel={onOpenPanel}>
        <p>First exception card</p><p>Second exception card</p>
      </PhaseExceptionGroup>,
    )

    const disclosure = screen.getByRole('button', { name: '2 exceptions · 1 needs review' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(disclosure).toHaveAttribute('aria-controls')
    expect(screen.queryByText('First exception card')).not.toBeInTheDocument()
    expect(screen.queryByText('Second exception card')).not.toBeInTheDocument()

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('First exception card')).toBeInTheDocument()
    expect(screen.getByText('Second exception card')).toBeInTheDocument()

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('First exception card')).not.toBeInTheDocument()
    expect(onOpenPanel).not.toHaveBeenCalled()
    expect(mockedReviewException).not.toHaveBeenCalled()
  })

  it('deduplicates duplicate ids before rendering counts and preserves the first occurrence order', () => {
    const first = exception('exception-1', 'needs_review')
    const duplicate = { ...first, description: 'Duplicate should not render' }
    const second = exception('exception-2', 'recorded')

    render(
      <PhaseExceptionGroup phaseId={phaseId} exceptions={[first, duplicate, second]} onOpenPanel={vi.fn()}>
        <p>{first.description}</p><p>{second.description}</p>
      </PhaseExceptionGroup>,
    )

    expect(screen.getByRole('button', { name: '2 exceptions · 1 needs review' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2 exceptions · 1 needs review' }))
    expect(screen.getByText(first.description)).toBeInTheDocument()
    expect(screen.getByText(second.description)).toBeInTheDocument()
  })

  it('updates a reviewed badge without collapsing an open group and omits a zero-count group', () => {
    const finding = exception('exception-1', 'needs_review')
    const { rerender } = render(
      <PhaseExceptionGroup phaseId={phaseId} exceptions={[finding]} onOpenPanel={vi.fn()}>
        <p>{finding.description}</p>
      </PhaseExceptionGroup>,
    )
    const toggle = screen.getByRole('button', { name: '1 exception · 1 needs review' })
    fireEvent.click(toggle)

    rerender(<PhaseExceptionGroup phaseId={phaseId} exceptions={[{ ...finding, review_status: 'reviewed' }]} onOpenPanel={vi.fn()}>
      <p>{finding.description}</p>
    </PhaseExceptionGroup>)
    expect(screen.getByRole('button', { name: '1 exception · 0 need review' })).toHaveAttribute('aria-expanded', 'true')

    rerender(<PhaseExceptionGroup phaseId={phaseId} exceptions={[]} onOpenPanel={vi.fn()}><p>Nothing</p></PhaseExceptionGroup>)
    expect(screen.queryByRole('button', { name: /exception/ })).not.toBeInTheDocument()
  })

  it('opens, focuses, and reports one external timeline reveal request', async () => {
    const onRevealHandled = vi.fn()
    render(<PhaseExceptionGroup phaseId={phaseId} exceptions={[exception('exception-1', 'recorded')]} onOpenPanel={vi.fn()} revealRequest={{ phaseId, requestId: 1 }} onRevealHandled={onRevealHandled}>
      <p>Revealed exception card</p>
    </PhaseExceptionGroup>)

    await waitFor(() => expect(screen.getByRole('button', { name: '1 exception · 0 need review' })).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.getByText('Revealed exception card')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Exceptions' })).toHaveFocus())
    expect(onRevealHandled).toHaveBeenCalledOnce()
  })
})
