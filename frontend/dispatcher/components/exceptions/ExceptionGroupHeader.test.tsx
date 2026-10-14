import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExceptionGroupHeader } from './ExceptionGroupHeader'
import type { ExceptionTripGroup } from '@/lib/exceptions/queue'

const GROUP: ExceptionTripGroup = {
  tripId: 'trip-1',
  tripReference: 'FP-2026-0001',
  items: [],
  severityCounts: { critical: 2, warning: 1, info: 0 },
  newestRaised: '2026-10-02T10:00:00Z',
  oldestRaised: '2026-10-01T10:00:00Z',
  unreviewedCount: 3,
  claimCount: 1,
}

describe('ExceptionGroupHeader', () => {
  it('shows the trip, its counts and the raised range', () => {
    render(<ExceptionGroupHeader group={GROUP} open={false} bodyId="body-1" onToggle={vi.fn()} />)

    const header = screen.getByRole('button', { name: /Trip FP-2026-0001/ })
    expect(header).toHaveTextContent('2 critical · 1 warning · 0 info · 3 unreviewed · 1 claimed')
    expect(header).toHaveTextContent('Newest · 02 Oct 2026, 12:00 SAST')
    expect(header).toHaveTextContent('Oldest · 01 Oct 2026, 12:00 SAST')
  })

  it('reports its open state and the body it controls', () => {
    const { rerender } = render(<ExceptionGroupHeader group={GROUP} open={false} bodyId="body-1" onToggle={vi.fn()} />)

    const header = screen.getByRole('button')
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveAttribute('aria-controls', 'body-1')
    expect(header).toHaveTextContent('Expand')

    rerender(<ExceptionGroupHeader group={GROUP} open bodyId="body-1" onToggle={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button')).toHaveTextContent('Collapse')
  })

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn()
    render(<ExceptionGroupHeader group={GROUP} open={false} bodyId="body-1" onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
