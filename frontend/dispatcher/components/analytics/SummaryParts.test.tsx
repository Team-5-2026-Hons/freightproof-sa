import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AnalyticsSummaryFrame } from './SummaryParts'

const RANGE = { start: '2026-08', end: '2026-10' }

function renderFrame(isLoading: boolean) {
  return render(
    <AnalyticsSummaryFrame
      range={RANGE}
      onRangeChange={vi.fn()}
      isLoading={isLoading}
      error={null}
      onRetry={vi.fn()}
      source="Closed trips only."
    >
      <p>Figures</p>
    </AnalyticsSummaryFrame>,
  )
}

describe('AnalyticsSummaryFrame', () => {
  it('shows a skeleton of the figures while loading, not a spinner', () => {
    const { container } = renderFrame(true)

    const loading = screen.getByRole('status', { name: 'Loading' })
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(loading.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('Figures')).toBeNull()
  })

  it('shows the figures once loaded', () => {
    renderFrame(false)

    expect(screen.getByText('Figures')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
  })

  it('keeps the source behind an info button instead of a permanent line', () => {
    renderFrame(false)

    expect(screen.queryByText('Closed trips only.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'About these figures' }))

    expect(screen.getByText('Closed trips only.')).toBeInTheDocument()
  })
})
