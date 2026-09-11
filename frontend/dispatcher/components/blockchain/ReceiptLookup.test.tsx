import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReceiptLookup } from './ReceiptLookup'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_HEDERA_HASHSCAN_BASE', 'https://hashscan.io/mainnet///')
})

const hookMock = vi.hoisted(() => ({
  results: [] as BlockchainReceipt[],
  loading: false,
  error: null as string | null,
  searched: false,
  clear: vi.fn(),
  lookup: vi.fn(),
}))

vi.mock('@/lib/hooks/useBlockchainReceiptLookup', () => ({
  useBlockchainReceiptLookup: () => hookMock,
}))

const HASH = 'a'.repeat(64)
const SECOND_HASH = 'b'.repeat(64)
const SUBJECT_ID = '123e4567-e89b-42d3-a456-426614174000'

function makeReceipt(overrides: Partial<BlockchainReceipt> = {}): BlockchainReceipt {
  return {
    id: 'receipt-1',
    subject_type: 'phase_event',
    subject_id: SUBJECT_ID,
    receipt_type: 'pickup',
    data_hash: HASH,
    hedera_topic_id: '0.0.1234',
    hedera_sequence_number: 42,
    hedera_consensus_timestamp: '2026-09-08T10:11:12Z',
    hedera_tx_id: '0.0.1234@1788862272.000000001',
    created_at: '2026-09-08T10:11:10Z',
    ...overrides,
  }
}

beforeEach(() => {
  hookMock.results = []
  hookMock.loading = false
  hookMock.error = null
  hookMock.searched = false
  hookMock.clear.mockReset()
  hookMock.lookup.mockReset()
})

afterAll(() => vi.unstubAllEnvs())

describe('ReceiptLookup validation', () => {
  it('announces a missing identifier and clears the summary when corrected', async () => {
    const user = userEvent.setup()
    render(<ReceiptLookup />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Search receipts' }))

    expect(screen.getByText('Enter an identifier.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Check the search fields.')
    expect(screen.getByRole('alert')).toHaveTextContent('SHA-256 hash: Enter an identifier.')
    expect(hookMock.lookup).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: /SHA-256 hash/i }), {
      target: { value: HASH },
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects a malformed hash and subject UUID', async () => {
    const user = userEvent.setup()
    render(<ReceiptLookup />)

    fireEvent.change(screen.getByRole('textbox', { name: /SHA-256 hash/i }), {
      target: { value: 'not-a-hash' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Subject UUID/i }), {
      target: { value: 'not-a-uuid' },
    })
    await user.click(screen.getByRole('button', { name: 'Search receipts' }))

    expect(screen.getByText('Enter a 64-character hexadecimal SHA-256 hash.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid UUID.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'SHA-256 hash: Enter a 64-character hexadecimal SHA-256 hash.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Subject UUID: Enter a valid UUID.')
    expect(hookMock.lookup).not.toHaveBeenCalled()
  })

  it('submits trimmed valid hash and subject criteria', async () => {
    const user = userEvent.setup()
    render(<ReceiptLookup />)

    fireEvent.change(screen.getByRole('textbox', { name: /SHA-256 hash/i }), {
      target: { value: `  ${HASH}  ` },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Subject UUID/i }), {
      target: { value: `  ${SUBJECT_ID}  ` },
    })
    await user.click(screen.getByRole('button', { name: 'Search receipts' }))

    expect(hookMock.lookup).toHaveBeenCalledWith({
      type: 'data_hash',
      identifier: HASH,
      subjectId: SUBJECT_ID,
    })
  })

  it('allows an exact Hedera transaction ID without applying hash validation', async () => {
    const user = userEvent.setup()
    render(<ReceiptLookup />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Search by' }), 'hedera_tx_id')
    fireEvent.change(screen.getByRole('textbox', { name: /Hedera transaction ID/i }), {
      target: { value: '0.0.1234@1788862272.000000001' },
    })
    await user.click(screen.getByRole('button', { name: 'Search receipts' }))

    expect(hookMock.lookup).toHaveBeenCalledWith({
      type: 'hedera_tx_id',
      identifier: '0.0.1234@1788862272.000000001',
    })
  })

  it('rejects a Hedera transaction ID longer than the API limit', async () => {
    const user = userEvent.setup()
    render(<ReceiptLookup />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Search by' }), 'hedera_tx_id')
    fireEvent.change(screen.getByRole('textbox', { name: /Hedera transaction ID/i }), {
      target: { value: 'x'.repeat(201) },
    })
    await user.click(screen.getByRole('button', { name: 'Search receipts' }))

    expect(
      screen.getByText('Hedera transaction ID must be 200 characters or fewer.'),
    ).toBeInTheDocument()
    expect(hookMock.lookup).not.toHaveBeenCalled()
  })
})

describe('ReceiptLookup states', () => {
  it('shows a loading state', () => {
    hookMock.loading = true
    render(<ReceiptLookup />)

    expect(screen.getByText('Searching receipt ledger...')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search receipts' })).toBeDisabled()
  })

  it('shows a clear request error', () => {
    hookMock.error = 'You do not have permission to view these receipts.'
    hookMock.searched = true
    render(<ReceiptLookup />)

    expect(screen.getByRole('alert')).toHaveTextContent('Receipt lookup failed')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You do not have permission to view these receipts.',
    )
  })

  it('allows long request errors to shrink and wrap within the error panel', () => {
    hookMock.error = `Request to /api/v1/blockchain/receipts/lookup?data_hash=${HASH}&subject_id=${SUBJECT_ID} failed: Failed to fetch`
    hookMock.searched = true
    render(<ReceiptLookup />)

    expect(screen.getByRole('alert')).toHaveTextContent(hookMock.error)
    expect(screen.getByText(hookMock.error).parentElement).toHaveClass('min-w-0', 'break-words')
  })

  it('shows no-results messaging only after a completed search', () => {
    const { rerender } = render(<ReceiptLookup />)
    expect(screen.queryByText('No matching receipts')).not.toBeInTheDocument()

    hookMock.searched = true
    rerender(<ReceiptLookup />)

    expect(screen.getByText('No matching receipts')).toBeInTheDocument()
  })

  it('clears stale results when search criteria change', () => {
    hookMock.searched = true
    hookMock.results = [makeReceipt()]
    render(<ReceiptLookup />)

    fireEvent.change(screen.getByRole('textbox', { name: /SHA-256 hash/i }), {
      target: { value: SECOND_HASH },
    })

    expect(hookMock.clear).toHaveBeenCalledOnce()
  })

  it('renders receipt fields and prefers the transaction message when both identifiers exist', () => {
    hookMock.searched = true
    hookMock.results = [
      makeReceipt(),
      makeReceipt({
        id: 'receipt-2',
        subject_type: 'driver',
        subject_id: '223e4567-e89b-42d3-a456-426614174001',
        receipt_type: 'driver_updated',
        data_hash: SECOND_HASH,
        hedera_topic_id: null,
        hedera_sequence_number: null,
        hedera_consensus_timestamp: null,
        hedera_tx_id: null,
        created_at: '2026-09-08T11:12:13Z',
      }),
    ]
    render(<ReceiptLookup />)

    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('pickup')).toBeInTheDocument()
    expect(within(cards[0]).getByText('phase_event')).toBeInTheDocument()
    expect(within(cards[0]).getByText(SUBJECT_ID)).toBeInTheDocument()
    expect(within(cards[0]).getByText(HASH)).toBeInTheDocument()
    expect(within(cards[0]).getByText('0.0.1234@1788862272.000000001')).toBeInTheDocument()
    expect(within(cards[0]).getByText('0.0.1234')).toBeInTheDocument()
    expect(within(cards[0]).getByText('42')).toBeInTheDocument()
    expect(within(cards[0]).getByText('2026-09-08T10:11:12Z')).toBeInTheDocument()
    expect(within(cards[0]).getByText('2026-09-08T10:11:10Z')).toBeInTheDocument()
    const hashScanLink = within(cards[0]).getByRole('link', {
      name: 'View transaction message on HashScan',
    })
    expect(hashScanLink).toHaveAttribute(
      'href',
      'https://hashscan.io/mainnet/transaction/0.0.1234%401788862272.000000001/message',
    )
    expect(hashScanLink).toHaveAttribute('target', '_blank')
    expect(hashScanLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(cards[1]).queryByRole('link')).not.toBeInTheDocument()
    expect(within(cards[1]).getAllByText('Not recorded')).toHaveLength(4)
    expect(screen.getByText(/These results are stored receipts, not an independent verification/))
      .toHaveTextContent('compare the hash it contains with the data hash shown here.')
  })
})

describe('ReceiptLookup explorer links', () => {
  it('links transaction-only receipts without requiring a topic or sequence number', () => {
    hookMock.results = [makeReceipt({
      hedera_topic_id: null,
      hedera_sequence_number: null,
    })]
    render(<ReceiptLookup />)

    expect(screen.getByRole('link', { name: 'View transaction message on HashScan' }))
      .toHaveAttribute(
        'href',
        'https://hashscan.io/mainnet/transaction/0.0.1234%401788862272.000000001/message',
      )
  })

  it.each([null, 42])('links topic-only receipts honestly with sequence %s', (sequenceNumber) => {
    hookMock.results = [makeReceipt({
      hedera_tx_id: null,
      hedera_sequence_number: sequenceNumber,
    })]
    render(<ReceiptLookup />)

    const link = screen.getByRole('link', { name: 'View topic on HashScan' })
    expect(link).toHaveAttribute('href', 'https://hashscan.io/mainnet/topic/0.0.1234')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: /View transaction message/ })).not.toBeInTheDocument()
  })

  it.each([null, ''])('omits links when both explorer identifiers are %s', (identifier) => {
    hookMock.results = [makeReceipt({
      hedera_tx_id: identifier,
      hedera_topic_id: identifier,
      hedera_sequence_number: null,
    })]
    render(<ReceiptLookup />)

    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each([
    {
      kind: 'transaction',
      overrides: { hedera_tx_id: '0.0.1234@1788862272.000000001?scheduled' },
      path: 'transaction/0.0.1234%401788862272.000000001%3Fscheduled/message',
    },
    {
      kind: 'topic',
      overrides: { hedera_tx_id: null, hedera_topic_id: '0.0.1234/extra?view=1#message' },
      path: 'topic/0.0.1234%2Fextra%3Fview%3D1%23message',
    },
  ])('encodes the $kind segment and strips trailing slashes from the custom base', ({ overrides, path }) => {
    hookMock.results = [makeReceipt(overrides)]
    render(<ReceiptLookup />)

    expect(screen.getByRole('link')).toHaveAttribute('href', `https://hashscan.io/mainnet/${path}`)
  })
})
