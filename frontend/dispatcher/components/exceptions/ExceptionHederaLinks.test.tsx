import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExceptionHederaLinks } from './ExceptionHederaLinks'
import type { EvidenceAnchorSummary } from '@shared/lib/types/exception'

const forensic = vi.hoisted(() => ({ canViewForensics: true, forensicOn: true, toggle: vi.fn() }))
vi.mock('@/lib/context/ForensicModeContext', () => ({ useForensicMode: () => forensic }))

function eventOf(overrides: Partial<EvidenceAnchorSummary> = {}): EvidenceAnchorSummary {
  return {
    event_id: crypto.randomUUID(),
    receipt_type: 'exception_raised',
    anchor_status: 'anchored',
    receipt_id: crypto.randomUUID(),
    occurred_at: '2026-09-03T10:00:00Z',
    hedera_topic_id: '0.0.4242',
    hedera_sequence_number: 17,
    ...overrides,
  }
}

beforeEach(() => {
  forensic.canViewForensics = true
  forensic.forensicOn = true
})

describe('ExceptionHederaLinks', () => {
  it('links an anchored event to its topic on HashScan', () => {
    render(<ExceptionHederaLinks events={[eventOf()]} />)

    const link = screen.getByRole('link', { name: /Raised.*HashScan/ })
    expect(link.getAttribute('href')).toMatch(/\/topic\/0\.0\.4242$/)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText(/seq #17/)).toBeInTheDocument()
  })

  it('lists one row per anchored event, in the order given', () => {
    render(<ExceptionHederaLinks events={[
      eventOf({ receipt_type: 'exception_raised', hedera_sequence_number: 1 }),
      eventOf({ receipt_type: 'exception_reviewed', hedera_sequence_number: 2 }),
      eventOf({ receipt_type: 'trip_cancelled', hedera_sequence_number: 3 }),
    ]} />)

    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/Raised.*seq #1/),
      expect.stringMatching(/Reviewed.*seq #2/),
      expect.stringMatching(/Trip cancelled.*seq #3/),
    ])
  })

  it.each([
    ['pending', { anchor_status: 'pending', receipt_id: null, hedera_topic_id: null, hedera_sequence_number: null }],
    ['failed', { anchor_status: 'failed', receipt_id: null, hedera_topic_id: null, hedera_sequence_number: null }],
    ['an empty topic', { hedera_topic_id: '' }],
    ['the literal "None" topic', { hedera_topic_id: 'None' }],
    ['a missing sequence number', { hedera_sequence_number: null }],
  ] as const)('shows nothing for %s', (_name, overrides) => {
    const { container } = render(<ExceptionHederaLinks events={[eventOf(overrides)]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows only the anchored rows when mixed with pending ones, and no status text', () => {
    render(<ExceptionHederaLinks events={[
      eventOf({ anchor_status: 'pending', receipt_id: null, hedera_topic_id: null, hedera_sequence_number: null }),
      eventOf({ receipt_type: 'exception_reviewed', hedera_sequence_number: 9 }),
    ]} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/pending|failed|retry|anchor/i)).not.toBeInTheDocument()
  })

  it('shows nothing when there are no events', () => {
    const { container } = render(<ExceptionHederaLinks events={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing with forensic mode off', () => {
    forensic.forensicOn = false

    const { container } = render(<ExceptionHederaLinks events={[eventOf()]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing to a user who cannot view forensics', () => {
    forensic.canViewForensics = false

    const { container } = render(<ExceptionHederaLinks events={[eventOf()]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
