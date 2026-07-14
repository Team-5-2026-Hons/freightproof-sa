// frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/__tests__/SealReferencePersistence.test.tsx
//
// Task 1 (CRITICAL): the seal number captured at H2 (loading) must still be available for
// comparison at H3 (exit) and H4 (destination), even though H2's own draft is cleared the
// moment it submits successfully. This suite renders the real HandshakeStepPageClient (not
// mocking useHandshakeDraft or useSealReference — only the network/router edges) across
// separate mounts to stand in for real navigation between steps, and asserts the seal
// reference — not h2Draft — is what reaches H3/H4.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import HandshakeStepPageClient from '../HandshakeStepPageClient'

const TRIP_ID = 'trip-seal-1'

const mockUseParams = vi.fn()
const mockRouterPush = vi.fn()
const mockSubmitHandshake = vi.fn()
const mockRefetchTrip = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockRouterPush, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({ trip: { id: TRIP_ID, status: 'loading' }, isLoading: false, refetchTrip: mockRefetchTrip }),
}))

vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ enqueue: vi.fn() }) }))
vi.mock('@/lib/api/handshakes', () => ({ submitHandshake: (...args: unknown[]) => mockSubmitHandshake(...args) }))

// Everything except the steps under test is a no-op stub — parallel work touches step
// internals constantly, and this suite only cares about the seal-reference plumbing.
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
vi.mock('@/components/handshake/steps/H3ExitSeal', () => ({
  H3ExitSeal: ({ h2SealNumber }: { h2SealNumber: string | null }) => <p>h3-seal:{h2SealNumber ?? 'null'}</p>,
}))
vi.mock('@/components/handshake/steps/H3Departure', () => ({ H3Departure: () => null }))
vi.mock('@/components/handshake/steps/H4ApproachDest', () => ({ H4ApproachDest: () => null }))
vi.mock('@/components/handshake/steps/H4EntryPhoto', () => ({ H4EntryPhoto: () => null }))
vi.mock('@/components/handshake/steps/H4SealVerify', () => ({
  H4SealVerify: ({ h2SealNumber }: { h2SealNumber: string | null }) => <p>h4-seal:{h2SealNumber ?? 'null'}</p>,
}))
vi.mock('@/components/handshake/steps/H5HandWaybill', () => ({ H5HandWaybill: () => null }))
vi.mock('@/components/handshake/steps/H5SealInspection', () => ({ H5SealInspection: () => null }))
vi.mock('@/components/handshake/steps/H5VisualCount', () => ({ H5VisualCount: () => null }))
vi.mock('@/components/handshake/steps/H5PodPhoto', () => ({ H5PodPhoto: () => null }))
vi.mock('@/components/handshake/steps/H5Reconciliation', () => ({ H5Reconciliation: () => null }))
vi.mock('@/components/handshake/steps/H5Closed', () => ({
  H5Closed: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>submit-h5</button>,
}))

function sealReferenceKey(): string {
  return `fp:seal-reference:${TRIP_ID}`
}

function h2DraftKey(): string {
  return `fp_draft_${TRIP_ID}_loading`
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockRefetchTrip.mockResolvedValue({ id: TRIP_ID, status: 'loading' })
  mockSubmitHandshake.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('seal reference survives past h2Draft being cleared', () => {
  it('(a) persists the H2 seal so H3 receives it after h2Draft is cleared', async () => {
    // Seed the H2 draft as if the driver captured a seal during loading.
    localStorage.setItem(h2DraftKey(), JSON.stringify({ sealNumber: 'FP-9999' }))

    mockUseParams.mockReturnValue({ h: '2', slug: '5-review' })
    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h2'))

    await waitFor(() => expect(mockSubmitHandshake).toHaveBeenCalled())
    // h2Draft is now cleared — confirm the assumption that made the bug real.
    expect(localStorage.getItem(h2DraftKey())).toBeNull()
    // But the durable reference survived it.
    expect(localStorage.getItem(sealReferenceKey())).toBe('FP-9999')
    cleanup()

    // A fresh mount at H3 (standing in for real navigation) must still see the seal.
    mockUseParams.mockReturnValue({ h: '3', slug: '2-exit-and-seal' })
    render(<HandshakeStepPageClient />)

    expect(await screen.findByText('h3-seal:FP-9999')).toBeInTheDocument()
  })

  it('(b) H4 also receives the non-null reference', async () => {
    localStorage.setItem(sealReferenceKey(), 'FP-9999')

    mockUseParams.mockReturnValue({ h: '4', slug: '3-seal-verify' })
    render(<HandshakeStepPageClient />)

    expect(await screen.findByText('h4-seal:FP-9999')).toBeInTheDocument()
  })

  it('(c) the reference survives a remount via localStorage', () => {
    localStorage.setItem(sealReferenceKey(), 'FP-REMOUNT')

    mockUseParams.mockReturnValue({ h: '3', slug: '2-exit-and-seal' })
    const { unmount } = render(<HandshakeStepPageClient />)
    expect(screen.getByText('h3-seal:FP-REMOUNT')).toBeInTheDocument()
    unmount()

    render(<HandshakeStepPageClient />)
    expect(screen.getByText('h3-seal:FP-REMOUNT')).toBeInTheDocument()
  })

  it('(d) is cleared once H5 (unloading) completes — trip closed', async () => {
    localStorage.setItem(sealReferenceKey(), 'FP-9999')

    mockUseParams.mockReturnValue({ h: '5', slug: '6-closed' })
    mockRefetchTrip.mockResolvedValue({ id: TRIP_ID, status: 'unloading' })
    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('submit-h5'))

    await waitFor(() => expect(mockSubmitHandshake).toHaveBeenCalled())
    expect(localStorage.getItem(sealReferenceKey())).toBeNull()
  })
})
