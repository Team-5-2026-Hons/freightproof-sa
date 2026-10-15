import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildTimeline } from '@/lib/timeline'
import type { ExceptionAnchorRecord, ExceptionPhoto, ExceptionRecord } from '@/lib/types'
import { makeException, makeManifest, makePhase } from '@/test/factories'
import { EventDetail } from './EventDetail'

// Evidence bytes are fetched through the authorised artifact endpoint; here they are just bytes.
vi.mock('@/lib/api', () => ({ fetchArtifactBytes: () => Promise.resolve(new ArrayBuffer(8)) }))

function phaseItem(...args: Parameters<typeof makePhase>) {
  const [item] = buildTimeline(makeManifest({ phases: [makePhase(...args)] }))
  return item
}

describe('EventDetail', () => {
  it('shows a damaged arrival seal as a finding', () => {
    // Arrange
    const item = phaseItem(3, 'arrival', { seal_number: 'SEAL-001', seal_condition: 'damaged' })

    // Act
    render(<EventDetail token="t" item={item} />)

    // Assert
    expect(screen.getByText('P3 · Arrival')).toBeInTheDocument()
    expect(screen.getByText('Seal condition')).toBeInTheDocument()
    expect(screen.getByText('Damaged')).toHaveClass('text-err')
  })

  it('shows an intact arrival seal as fine', () => {
    // Arrange
    const item = phaseItem(3, 'arrival', { seal_number: 'SEAL-001', seal_condition: 'intact' })

    // Act
    render(<EventDetail token="t" item={item} />)

    // Assert
    expect(screen.getByText('Intact')).toHaveClass('text-ok')
  })

  it('omits the condition row on a pack frozen before Arrival', () => {
    // Arrange
    const item = phaseItem(3, 'unloading', { seal_number: 'SEAL-001' })

    // Act
    render(<EventDetail token="t" item={item} />)

    // Assert
    expect(screen.queryByText('Seal condition')).not.toBeInTheDocument()
  })
})

describe('EventDetail — exception photos and anchors', () => {
  const photo = (position: number, overrides: Partial<ExceptionPhoto> = {}): ExceptionPhoto => ({
    artifact_id: `photo-${position}`, position, sha256: `${position}`.repeat(64), mime_type: 'image/jpeg',
    captured_at: '2026-09-12T11:00:00Z', tier: 'anchored', anchor_event_id: 'event-1', anchor_receipt_id: 'receipt-1',
    ...overrides,
  })
  const anchor = (overrides: Partial<ExceptionAnchorRecord> = {}): ExceptionAnchorRecord => ({
    event_id: 'event-1', action: 'raised', receipt_type: 'exception_raised', anchor_status: 'anchored',
    receipt_id: 'receipt-1', occurred_at: '2026-09-12T11:00:00Z', tier: 'anchored', ...overrides,
  })
  function exceptionItem(overrides: Partial<ExceptionRecord>) {
    const [item] = buildTimeline(makeManifest({ exceptions: [makeException('seal_broken_in_transit', 'critical', overrides)] }))
    return item
  }

  it('shows every photo with its own hash and the receipt that committed it', async () => {
    const item = exceptionItem({ tier: 'anchored', photos: [photo(0), photo(1)], anchors: [anchor()] })

    render(<EventDetail token="t" item={item} />)

    expect(await screen.findAllByRole('figure')).toHaveLength(2)
    expect(screen.getAllByText(/Committed by receipt receipt-1/)).toHaveLength(2)
    expect(screen.getByText(`sha256 ${'0'.repeat(64)}`)).toBeInTheDocument()
    expect(screen.getByText(`sha256 ${'1'.repeat(64)}`)).toBeInTheDocument()
  })

  it('says a photo with no receipt is not covered by one', async () => {
    const item = exceptionItem({
      tier: 'recorded', photos: [photo(0, { tier: 'recorded', anchor_event_id: null, anchor_receipt_id: null })],
      anchors: [anchor({ anchor_status: 'pending', receipt_id: null, tier: 'recorded' })],
    })

    render(<EventDetail token="t" item={item} />)

    expect(await screen.findByText('Not covered by a receipt')).toBeInTheDocument()
    expect(screen.queryByText(/Committed by receipt/)).not.toBeInTheDocument()
  })

  it('shows pending and failed anchors plainly, as recorded and never as anchored', () => {
    const item = exceptionItem({
      tier: 'recorded',
      anchors: [
        anchor({ event_id: 'event-1', anchor_status: 'pending', receipt_id: null, tier: 'recorded' }),
        anchor({ event_id: 'event-2', action: 'reviewed', receipt_type: 'exception_reviewed', anchor_status: 'failed', receipt_id: null, tier: 'recorded' }),
        anchor({ event_id: 'event-3', action: 'cancelled', receipt_type: 'trip_cancelled' }),
      ],
    })

    render(<EventDetail token="t" item={item} />)

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Recorded — anchoring pending')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('Anchored')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('Recorded — anchoring failed, will retry')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('Anchored')).not.toBeInTheDocument()
    expect(within(rows[2]).getByText('Anchored')).toBeInTheDocument()
    expect(within(rows[2]).getByText(/Receipt receipt-1/)).toBeInTheDocument()
  })

  it('does not present an anchored status as anchored when the record no longer matches it', () => {
    const item = exceptionItem({ tier: 'recorded', anchors: [anchor({ tier: 'recorded' })] })

    render(<EventDetail token="t" item={item} />)

    expect(screen.getByText('Recorded — the record no longer matches its anchor')).toBeInTheDocument()
    expect(screen.queryByText('Anchored')).not.toBeInTheDocument()
  })

  it('states what an anchor does not prove and keeps GPS as recorded', () => {
    const item = exceptionItem({
      tier: 'anchored', anchors: [anchor()], position_tier: 'recorded',
      position: { lat: -28.27, lng: 29.13, source: 'driver_phone', recorded_at: null, accuracy_metres: null },
    })

    render(<EventDetail token="t" item={item} />)

    expect(screen.getByText(/does not prove the incident occurred/i)).toBeInTheDocument()
    expect(screen.getByText('Position').closest('div')).toHaveTextContent(/Recorded/)
    expect(screen.queryByText(/location verified/i)).not.toBeInTheDocument()
  })

  it('still renders a v1 exception from its single evidence file', async () => {
    const item = exceptionItem({
      evidence: [{ artifact_id: 'legacy', role: 'exception_supporting', sha256: 'f'.repeat(64), mime_type: 'image/jpeg', captured_at: '2026-09-12T11:00:00Z', tier: 'recorded' }],
    })

    render(<EventDetail token="t" item={item} />)

    expect(await screen.findAllByRole('figure')).toHaveLength(1)
    expect(screen.queryByText('Record anchors')).not.toBeInTheDocument()
  })
})
