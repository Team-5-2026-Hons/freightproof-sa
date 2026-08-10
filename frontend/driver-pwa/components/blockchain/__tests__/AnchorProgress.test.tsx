// frontend/driver-pwa/components/blockchain/__tests__/AnchorProgress.test.tsx
import { render, screen, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AnchorProgress } from '../AnchorProgress'

const SAMPLE_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
const SAMPLE_RECEIPT = 'bcr-0035-h2'
const LONG_WAIT_MS = 15_000
const LONG_WAIT_COPY = 'Still anchoring — Hedera consensus can take a minute on a slow connection.'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AnchorProgress', () => {
  it('renders nothing when eventHash is null (feeder handshake, or not yet completed)', () => {
    const { container } = render(<AnchorProgress eventHash={null} receiptId={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when eventHash is null even if receiptId is somehow present', () => {
    const { container } = render(<AnchorProgress eventHash={null} receiptId={SAMPLE_RECEIPT} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('in-progress state: hash present, no receipt — shows a spinner row and a pending row', () => {
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={null} />)

    const truncated = `${SAMPLE_HASH.slice(0, 8)}…${SAMPLE_HASH.slice(-8)}`
    expect(screen.getByText(`Evidence hashed — ${truncated}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Submitted to Hedera HCS')).toBeInTheDocument()
    expect(screen.getByText('Anchor receipt recorded')).toBeInTheDocument()

    // Row 2 is in-progress (spinning) — no completed receipt text yet.
    expect(screen.queryByText(SAMPLE_RECEIPT, { exact: false })).not.toBeInTheDocument()
  })

  it('complete state: hash and receipt both present — all three rows read complete, receipt truncated', () => {
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    const truncatedHash = `${SAMPLE_HASH.slice(0, 8)}…${SAMPLE_HASH.slice(-8)}`
    expect(screen.getByText(`Evidence hashed — ${truncatedHash}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Submitted to Hedera HCS')).toBeInTheDocument()
    // SAMPLE_RECEIPT is short enough that truncateHash returns it unchanged.
    expect(screen.getByText(`Anchor receipt recorded — ${SAMPLE_RECEIPT}`, { exact: false })).toBeInTheDocument()
  })

  it('carries the full event hash via title and an sr-only span (never hides evidence)', () => {
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    const row = screen.getByText(`Full event hash ${SAMPLE_HASH}`, { exact: false }).closest('li')
    expect(row?.getAttribute('title')).toContain(SAMPLE_HASH)
  })

  it('passes through className to the outer list', () => {
    const { container } = render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} className="mt-2" />)

    expect(container.firstChild).toHaveClass('mt-2')
  })
})

// Task F1: a driver on a slow connection sees a bare spinner with no sense of
// whether anchoring is stuck or just slow. Past LONG_WAIT_MS, reassure them their
// evidence is already safe on-device rather than let the spinner read as a stall.
describe('AnchorProgress — long-wait copy (Task F1)', () => {
  it('shows the long-wait copy after LONG_WAIT_MS while still pending', () => {
    vi.useFakeTimers()
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={null} />)

    expect(screen.queryByText(LONG_WAIT_COPY, { exact: false })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(LONG_WAIT_MS)
    })

    expect(screen.getByText(LONG_WAIT_COPY, { exact: false })).toBeInTheDocument()
  })

  it('never shows the long-wait copy when anchored from the start', () => {
    vi.useFakeTimers()
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    act(() => {
      vi.advanceTimersByTime(LONG_WAIT_MS)
    })

    expect(screen.queryByText(LONG_WAIT_COPY, { exact: false })).not.toBeInTheDocument()
  })

  it('clears the pending timer if the anchor completes before LONG_WAIT_MS, so the copy never appears', () => {
    vi.useFakeTimers()
    const { rerender } = render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={null} />)

    act(() => {
      vi.advanceTimersByTime(LONG_WAIT_MS - 1000)
    })
    rerender(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    act(() => {
      vi.advanceTimersByTime(LONG_WAIT_MS)
    })

    expect(screen.queryByText(LONG_WAIT_COPY, { exact: false })).not.toBeInTheDocument()
  })

  it('restarts the timer cleanly for a new pending cycle after a prior anchor completed', () => {
    vi.useFakeTimers()
    const { rerender } = render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    // A new handshake's evidence starts a fresh pending cycle.
    const nextHash = 'f0e1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'
    rerender(<AnchorProgress eventHash={nextHash} receiptId={null} />)

    expect(screen.queryByText(LONG_WAIT_COPY, { exact: false })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(LONG_WAIT_MS)
    })

    expect(screen.getByText(LONG_WAIT_COPY, { exact: false })).toBeInTheDocument()
  })
})
