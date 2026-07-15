// frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/__tests__/HandshakeStepPageClient.anchoring.test.tsx
//
// Task 4 (honest anchoring copy): the completion receipt must only claim a Hedera
// anchor for a REAL (non-demo), non-queued submission of H2 (loading) or H5
// (unloading) — the only two handshakes the backend actually anchors. This is a
// dedicated real-mode file (mirrors lib/context/__tests__/AuthContext.real.test.tsx)
// because IS_DEMO_MODE is read at module import time, so real vs. demo mode needs
// separate test files rather than per-test toggling within one.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HandshakeStepPageClient from '../HandshakeStepPageClient'
import { ApiError } from '@/lib/api/client'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockNotify = vi.fn()
const mockEnqueue = vi.fn()
const mockSubmitHandshake = vi.fn()
const mockRefetchTrip = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({
    trip: { id: 'trip-1', status: 'loading' },
    isLoading: false,
    refetchTrip: mockRefetchTrip,
  }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueue: mockEnqueue }),
}))

vi.mock('@/lib/hooks/useHandshakeDraft', () => ({
  useHandshakeDraft: (_tripId: string, _type: string, initial: unknown) => [initial, vi.fn(), vi.fn()],
}))

vi.mock('@/lib/api/handshakes', () => ({
  submitHandshake: (...args: unknown[]) => mockSubmitHandshake(...args),
}))

// Every step is stubbed except H2Review/H5Closed (the two anchored handshakes under
// test), matching the stubbing pattern in HandshakeStepPageClient.test.tsx and
// SealReferencePersistence.test.tsx.
vi.mock('@/components/handshake/steps/H1GateArrival', () => ({ H1GateArrival: () => null }))
vi.mock('@/components/handshake/steps/H1EntryPhoto', () => ({ H1EntryPhoto: () => null }))
vi.mock('@/components/handshake/steps/H1Verification', () => ({ H1Verification: () => null }))
vi.mock('@/components/handshake/steps/H2ArriveBay', () => ({ H2ArriveBay: () => null }))
vi.mock('@/components/handshake/steps/H2Linehaul', () => ({ H2Linehaul: () => null }))
vi.mock('@/components/handshake/steps/H2Waybill', () => ({ H2Waybill: () => null }))
vi.mock('@/components/handshake/steps/H2Seal', () => ({ H2Seal: () => null }))
vi.mock('@/components/handshake/steps/H2Review', () => ({
  H2Review: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>submit-h2</button>,
}))
vi.mock('@/components/handshake/steps/H3ApproachExit', () => ({ H3ApproachExit: () => null }))
vi.mock('@/components/handshake/steps/H3ExitSeal', () => ({ H3ExitSeal: () => null }))
vi.mock('@/components/handshake/steps/H3Departure', () => ({ H3Departure: () => null }))
vi.mock('@/components/handshake/steps/H4ApproachDest', () => ({ H4ApproachDest: () => null }))
vi.mock('@/components/handshake/steps/H4EntryPhoto', () => ({ H4EntryPhoto: () => null }))
vi.mock('@/components/handshake/steps/H4SealVerify', () => ({ H4SealVerify: () => null }))
vi.mock('@/components/handshake/steps/H5HandWaybill', () => ({ H5HandWaybill: () => null }))
vi.mock('@/components/handshake/steps/H5SealInspection', () => ({ H5SealInspection: () => null }))
vi.mock('@/components/handshake/steps/H5VisualCount', () => ({ H5VisualCount: () => null }))
vi.mock('@/components/handshake/steps/H5PodPhoto', () => ({ H5PodPhoto: () => null }))
vi.mock('@/components/handshake/steps/H5Reconciliation', () => ({ H5Reconciliation: () => null }))
vi.mock('@/components/handshake/steps/H5Closed', () => ({
  H5Closed: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>submit-h5</button>,
}))

describe('HandshakeStepPageClient anchoring receipt copy — real mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a real H2 (loading) success with the Hedera receipt back claims the anchor', async () => {
    mockUseParams.mockReturnValue({ h: '2', slug: '5-review' })
    mockSubmitHandshake.mockResolvedValue(undefined)
    // recordedNotice reads the refetched trip's own handshake row — receipt present.
    mockRefetchTrip.mockResolvedValue({
      id: 'trip-1', status: 'loading',
      handshakes: [{ sequence_number: 2, event_hash: 'a'.repeat(64), blockchain_receipt_id: 'receipt-1' }],
    })

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h2'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Loading recorded',
          body: expect.stringContaining('anchored to Hedera HCS'),
        }),
      ),
    )
  })

  it('a real H5 (unloading) success with the receipt back also claims the anchor', async () => {
    mockUseParams.mockReturnValue({ h: '5', slug: '6-closed' })
    mockSubmitHandshake.mockResolvedValue(undefined)
    mockRefetchTrip.mockResolvedValue({
      id: 'trip-1', status: 'unloading',
      handshakes: [{ sequence_number: 5, event_hash: 'b'.repeat(64), blockchain_receipt_id: 'receipt-2' }],
    })

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h5'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Unloading recorded',
          body: expect.stringContaining('anchored to Hedera HCS'),
        }),
      ),
    )
  })

  it('a real H2 success whose receipt has not come back yet says anchoring is in progress, not anchored', async () => {
    mockUseParams.mockReturnValue({ h: '2', slug: '5-review' })
    mockSubmitHandshake.mockResolvedValue(undefined)
    // Hash captured but no blockchain_receipt_id yet — claiming "anchored" here
    // would be dishonest; the driver is pointed at the trip screen's AnchorProgress.
    mockRefetchTrip.mockResolvedValue({
      id: 'trip-1', status: 'loading',
      handshakes: [{ sequence_number: 2, event_hash: 'a'.repeat(64), blockchain_receipt_id: null }],
    })

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h2'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Loading recorded',
          body: expect.stringContaining('anchoring in progress'),
        }),
      ),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('anchored to Hedera HCS') }),
    )
  })

  it('an offline-queued H2 submit (even in real mode) keeps the honest "stored on this device" wording — it never reached the backend, let alone Hedera', async () => {
    mockUseParams.mockReturnValue({ h: '2', slug: '5-review' })
    mockSubmitHandshake.mockRejectedValue(new TypeError('network down'))

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h2'))

    await waitFor(() => expect(mockEnqueue).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Loading recorded',
        body: expect.stringContaining('stored on this device'),
      }),
    )
  })

  it('a terminal 4xx on H2 fires no success toast at all (unaffected by the anchoring change)', async () => {
    mockUseParams.mockReturnValue({ h: '2', slug: '5-review' })
    mockSubmitHandshake.mockRejectedValue(new ApiError(422, 'missing seal photo'))

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h2'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  })
})
