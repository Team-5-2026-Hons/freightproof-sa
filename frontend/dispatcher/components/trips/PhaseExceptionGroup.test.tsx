import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PhaseExceptionGroup } from './PhaseExceptionGroup'
import type { TripException } from '@shared/lib/types/exception'
import { reviewException } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ reviewException: vi.fn() }))
const mockedReviewException = vi.mocked(reviewException)

const phaseId = 'phase-loading-1'

function exception(id: string, reviewStatus: TripException['review_status'], severity: TripException['severity'] = 'warning'): TripException {
  return {
    id: id as TripException['id'], trip_id: 'trip-1', exception_type: 'cargo_damage',
    source: 'driver', severity, description: `Recorded exception ${id}`,
    phase_event_id: phaseId, checkpoint_id: null, supporting_artifact_id: null,
    review_status: reviewStatus, review_outcome: null, reviewed_by_user_id: null,
    reviewed_at: null, review_note: null, contact_method: null, vehicle_id: null,
    merkle_batch_id: null, created_at: '2026-09-15T08:00:00Z', updated_at: '2026-09-15T08:00:00Z',
  }
}

describe('PhaseExceptionGroup', () => {
  it('starts collapsed and toggles its unique exception cards without reviewing either record', () => {
    mockedReviewException.mockReset()
    const first = exception('exception-1', 'needs_review')
    const second = exception('exception-2', 'recorded')

    render(
      <PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[first, second]} isLast={false}>
        <p>First exception card</p><p>Second exception card</p>
      </PhaseExceptionGroup>,
    )

    const disclosure = screen.getByRole('button', { name: /2 exceptions · 1 needs review/ })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(disclosure).toHaveAttribute('aria-controls')
    expect(screen.getByRole('group', { name: 'Exceptions linked to Loading phase' })).toBeInTheDocument()
    expect(screen.queryByText('First exception card')).not.toBeInTheDocument()
    expect(screen.queryByText('Second exception card')).not.toBeInTheDocument()

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('First exception card')).toBeInTheDocument()
    expect(screen.getByText('Second exception card')).toBeInTheDocument()

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('First exception card')).not.toBeInTheDocument()
    expect(mockedReviewException).not.toHaveBeenCalled()
  })

  it('shows the highest severity of the group on the collapsed row', () => {
    render(
      <PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[exception('a', 'recorded', 'info'), exception('b', 'needs_review', 'critical')]} isLast={false}>
        <p>Card</p>
      </PhaseExceptionGroup>,
    )

    expect(screen.getByRole('button', { name: /2 exceptions · 1 needs review/ })).toHaveTextContent('Critical')
    expect(screen.queryByText('Info')).not.toBeInTheDocument()
  })

  it('deduplicates duplicate ids before rendering counts and preserves the first occurrence order', () => {
    const first = exception('exception-1', 'needs_review')
    const duplicate = { ...first, description: 'Duplicate should not render' }
    const second = exception('exception-2', 'recorded')

    render(
      <PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[first, duplicate, second]} isLast={false}>
        <p>{first.description}</p><p>{second.description}</p>
      </PhaseExceptionGroup>,
    )

    const disclosure = screen.getByRole('button', { name: /2 exceptions · 1 needs review/ })
    fireEvent.click(disclosure)
    expect(screen.getByText(first.description)).toBeInTheDocument()
    expect(screen.getByText(second.description)).toBeInTheDocument()
  })

  it('updates a reviewed badge without collapsing an open group and omits a zero-count group', () => {
    const finding = exception('exception-1', 'needs_review')
    const { rerender } = render(
      <PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[finding]} isLast={false}>
        <p>{finding.description}</p>
      </PhaseExceptionGroup>,
    )
    fireEvent.click(screen.getByRole('button', { name: /1 exception · 1 needs review/ }))

    rerender(<PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[{ ...finding, review_status: 'reviewed' }]} isLast={false}>
      <p>{finding.description}</p>
    </PhaseExceptionGroup>)
    expect(screen.getByRole('button', { name: /1 exception · 0 need review/ })).toHaveAttribute('aria-expanded', 'true')

    rerender(<PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[]} isLast={false}><p>Nothing</p></PhaseExceptionGroup>)
    expect(screen.queryByRole('button', { name: /exception/ })).not.toBeInTheDocument()
  })

  it('opens, focuses its toggle, and reports one external timeline reveal request', async () => {
    const onRevealHandled = vi.fn()
    render(<PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[exception('exception-1', 'recorded')]} isLast revealRequest={{ phaseId, requestId: 1 }} onRevealHandled={onRevealHandled}>
      <p>Revealed exception card</p>
    </PhaseExceptionGroup>)

    const toggle = screen.getByRole('button', { name: /1 exception · 0 need review/ })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.getByText('Revealed exception card')).toBeInTheDocument()
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(onRevealHandled).toHaveBeenCalledOnce()
  })

  it('ignores a reveal request addressed to another phase', async () => {
    render(<PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[exception('exception-1', 'recorded')]} isLast revealRequest={{ phaseId: 'phase-other', requestId: 1 }}>
      <p>Hidden card</p>
    </PhaseExceptionGroup>)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.getByRole('button', { name: /1 exception/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Hidden card')).not.toBeInTheDocument()
  })

  it('keeps a reduced-motion reveal functional without relying on an animation', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, media: '(prefers-reduced-motion: reduce)', onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })

    try {
      render(<PhaseExceptionGroup phaseId={phaseId} phaseLabel="Loading" exceptions={[exception('exception-1', 'recorded')]} isLast revealRequest={{ phaseId, requestId: 1 }}>
        <p>Revealed exception card</p>
      </PhaseExceptionGroup>)

      await waitFor(() => expect(screen.getByRole('button', { name: /1 exception/ })).toHaveFocus())
      expect(screen.getByText('Revealed exception card')).toBeInTheDocument()
      expect(screen.getByText('Revealed exception card').parentElement).toHaveClass('motion-reduce:transition-none')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})
