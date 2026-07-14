import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HandshakeStepPageClient from '../HandshakeStepPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'

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
    trip: { id: 'trip-1', status: 'in_transit' },
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
  // [draft, update, clear] — the draft value itself is irrelevant to these tests.
  useHandshakeDraft: (_tripId: string, _type: string, initial: unknown) => [initial, vi.fn(), vi.fn()],
}))

vi.mock('@/lib/api/handshakes', () => ({
  submitHandshake: (...args: unknown[]) => mockSubmitHandshake(...args),
}))

// Every step component is stubbed: parallel tasks are actively editing
// components/handshake/, and this suite only cares about the page's
// submit-and-advance branch, not step internals. The step under test
// (H4SealVerify, the FINAL step of handshake 4) exposes its onComplete.
vi.mock('@/components/handshake/steps/H1GateArrival', () => ({ H1GateArrival: () => null }))
vi.mock('@/components/handshake/steps/H1EntryPhoto', () => ({ H1EntryPhoto: () => null }))
vi.mock('@/components/handshake/steps/H1Verification', () => ({ H1Verification: () => null }))
vi.mock('@/components/handshake/steps/H2ArriveBay', () => ({ H2ArriveBay: () => null }))
vi.mock('@/components/handshake/steps/H2Linehaul', () => ({ H2Linehaul: () => null }))
vi.mock('@/components/handshake/steps/H2Waybill', () => ({ H2Waybill: () => null }))
vi.mock('@/components/handshake/steps/H2Seal', () => ({ H2Seal: () => null }))
vi.mock('@/components/handshake/steps/H2Review', () => ({ H2Review: () => null }))
vi.mock('@/components/handshake/steps/H3ApproachExit', () => ({ H3ApproachExit: () => null }))
vi.mock('@/components/handshake/steps/H3ExitSeal', () => ({ H3ExitSeal: () => null }))
vi.mock('@/components/handshake/steps/H3Departure', () => ({ H3Departure: () => null }))
vi.mock('@/components/handshake/steps/H4ApproachDest', () => ({ H4ApproachDest: () => null }))
vi.mock('@/components/handshake/steps/H4EntryPhoto', () => ({ H4EntryPhoto: () => null }))
vi.mock('@/components/handshake/steps/H4SealVerify', () => ({
  H4SealVerify: ({ onComplete }: { onComplete: () => void }) => (
    <button onClick={onComplete}>complete-final-step</button>
  ),
}))
vi.mock('@/components/handshake/steps/H5HandWaybill', () => ({ H5HandWaybill: () => null }))
vi.mock('@/components/handshake/steps/H5SealInspection', () => ({ H5SealInspection: () => null }))
vi.mock('@/components/handshake/steps/H5VisualCount', () => ({ H5VisualCount: () => null }))
vi.mock('@/components/handshake/steps/H5PodPhoto', () => ({ H5PodPhoto: () => null }))
vi.mock('@/components/handshake/steps/H5Reconciliation', () => ({ H5Reconciliation: () => null }))
vi.mock('@/components/handshake/steps/H5Closed', () => ({ H5Closed: () => null }))

describe('HandshakeStepPageClient completion receipt (5a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Final step of handshake 4 — the walkthrough's silent-return case.
    mockUseParams.mockReturnValue({ h: '4', slug: '3-seal-verify' })
    mockRefetchTrip.mockResolvedValue({ id: 'trip-1', status: 'dest_gate_in' })
  })

  it('completing the last step fires a success toast with the handshake name and saved time, then redirects', async () => {
    mockSubmitHandshake.mockResolvedValue(undefined)

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('complete-final-step'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'success',
          title: 'Destination Gate-In recorded',
          // en-ZA HH:mm; wording claims device-local storage only, never chain/server sync.
          body: expect.stringMatching(/^Saved \d{2}:\d{2} — evidence stored on this device\.$/),
        }),
      ),
    )
    // Final step of H4 routes back to the active trip detail page.
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.activeTripDetail)
  })

  it('does not fire a success toast when submission fails with a terminal 4xx', async () => {
    mockSubmitHandshake.mockRejectedValue(new ApiError(422, 'missing seal photo'))

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('complete-final-step'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })),
    )
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('still fires the receipt toast when the submission is queued offline (evidence is on-device)', async () => {
    mockSubmitHandshake.mockRejectedValue(new TypeError('network down'))

    render(<HandshakeStepPageClient />)
    fireEvent.click(screen.getByText('complete-final-step'))

    await waitFor(() => expect(mockEnqueue).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Destination Gate-In recorded' }),
    )
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.activeTripDetail)
  })
})
