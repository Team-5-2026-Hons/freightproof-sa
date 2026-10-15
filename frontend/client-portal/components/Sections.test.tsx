import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeException } from '@/test/factories'
import { Exceptions } from './Sections'

describe('Exceptions section', () => {
  it('badges each exception with its own tier instead of a blanket recorded badge', () => {
    const anchored = makeException('seal_broken_in_transit', 'critical', { exception_id: 'a', tier: 'anchored' })
    const recorded = makeException('cargo_damage', 'warning', { exception_id: 'b', tier: 'recorded' })

    render(<Exceptions exceptions={[anchored, recorded]} onSelect={vi.fn()} />)

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Anchored')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Recorded')).toBeInTheDocument()
    expect(screen.getAllByText('Anchored')).toHaveLength(1)
  })

  it('shows no tier badge when there are no exceptions', () => {
    render(<Exceptions exceptions={[]} onSelect={vi.fn()} />)

    expect(screen.queryByText('Recorded')).not.toBeInTheDocument()
    expect(screen.getByText('No exceptions recorded.')).toBeInTheDocument()
  })

  it('summarises a pending raise as pending, never as anchored', () => {
    const pending = makeException('panic_button', 'critical', {
      tier: 'recorded',
      anchors: [{
        event_id: 'e', action: 'raised', receipt_type: 'exception_raised', anchor_status: 'pending',
        receipt_id: null, occurred_at: '2026-09-12T11:00:00Z', tier: 'recorded',
      }],
    })

    render(<Exceptions exceptions={[pending]} onSelect={vi.fn()} />)

    expect(screen.getByText(/Raised — Recorded, anchoring pending/)).toBeInTheDocument()
    expect(screen.queryByText('Anchored')).not.toBeInTheDocument()
  })

  it('keeps a failed anchor visible as retryable debt in the exceptions list', () => {
    const failed = makeException('panic_button', 'critical', {
      tier: 'recorded',
      anchors: [{
        event_id: 'e', action: 'reviewed', receipt_type: 'exception_reviewed', anchor_status: 'failed',
        receipt_id: null, occurred_at: '2026-09-12T11:00:00Z', tier: 'recorded',
      }],
    })

    render(<Exceptions exceptions={[failed]} onSelect={vi.fn()} />)

    expect(screen.getByText(/Reviewed — Recorded, anchoring failed, will retry/)).toBeInTheDocument()
  })
})
