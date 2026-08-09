import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PanicPage from '../page'
import { ROUTES } from '@/lib/constants/routes'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// Marks every phase up to and including `through` (by sequence_number) as completed —
// same local helper lib/phase/__tests__/derive.test.ts uses.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

// `trip` is provided to PanicPage via useTrip() (session-derived) — there's no URL
// param to verify against, so these tests only cover the loading/no-trip states and
// the handlePanic sequencing.
const mockUseTrip = vi.fn()
const mockRouterBack = vi.fn()
const mockRouterReplace = vi.fn()

// `capture` is reassigned per-test (success vs. GPS-failure payloads) for the
// handlePanic sequencing tests below — declared here so the module mock can
// reference a mutable function.
const mockCapture = vi.fn()

// Fix 2 (panic over-promise): asserted directly in the "queued" sequencing tests below
// so a failed logException can be told apart from an enqueued one without hitting real
// localStorage.
const mockEnqueueException = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockRouterBack, replace: mockRouterReplace, push: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useLocation', () => ({
  useLocation: () => ({
    coords: null,
    status: 'idle',
    capture: mockCapture,
  }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueueException: mockEnqueueException }),
}))

describe('PanicPage no-active-trip guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapture.mockResolvedValue({ latitude: -26.09, longitude: 28.13, accuracy: 5 })
  })

  it('renders an unavailable state and no swipe control when trip is null', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByText(/unable to verify trip/i)).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
  })

  it('renders the normal panic UI with the swipe control when a trip is present', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.queryByText(/unable to verify trip/i)).not.toBeInTheDocument()
    expect(screen.getByText(/send panic/i)).toBeInTheDocument()
  })

  it('fallback "Return to in-transit" button uses router.replace, not router.back', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, logException: vi.fn() })

    render(<PanicPage />)
    fireEvent.click(screen.getByText(/return to in-transit/i))

    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.inTransit)
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  // A blank screen on the PANIC page reads as a dead app at the worst possible
  // moment — the loading state must render a visible spinner, not `return null`.
  it('renders a spinner (not a blank screen) while the trip is loading', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: true, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unable to verify trip/i)).not.toBeInTheDocument()
  })

  // Cold load / deep link means the panic page may have no back-history — the main
  // Cancel button must replace to the in-transit hub, never pop an empty stack.
  it('main Cancel button uses router.replace to in-transit, not router.back', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException: vi.fn() })

    render(<PanicPage />)
    fireEvent.click(screen.getByText(/cancel/i))

    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.inTransit)
    expect(mockRouterBack).not.toHaveBeenCalled()
  })
})

describe('PanicPage handlePanic sequencing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // SwipeToConfirm's onConfirm only fires after its own SETTLE_DURATION_MS handoff
  // delay, and only once armed twice — so we drive its keyboard path (Enter, Enter)
  // rather than a real pointer drag: this test suite only cares about handlePanic's
  // downstream sequencing (GPS capture, logException, queueing), not the drag gesture
  // itself, which has its own dedicated coverage in SwipeToConfirm.test.tsx.
  function confirmPanicSwipe() {
    const slider = screen.getByRole('slider', { name: /send panic/i })

    fireEvent.keyDown(slider, { key: 'Enter' }) // arm
    fireEvent.keyDown(slider, { key: 'Enter' }) // confirm

    act(() => {
      // SwipeToConfirm's SETTLE_DURATION_MS (180ms) handoff delay before onConfirm
      // actually fires.
      vi.advanceTimersByTime(180)
    })
  }

  it('captures GPS, logs the exception with coords, and navigates to panic/submitted', async () => {
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue({ latitude: -26.09, longitude: 28.13, accuracy: 5 })

    render(<PanicPage />)
    confirmPanicSwipe()

    // capture() and logException() are awaited/called inside an async
    // handler invoked from a fake-timer callback — flush microtasks so
    // those promise continuations resolve before asserting.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockCapture).toHaveBeenCalled()
    expect(logException).toHaveBeenCalledWith(
      'panic_button',
      expect.objectContaining({ gpsLat: -26.09, gpsLng: 28.13 }),
    )
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.panicSubmitted)
  })

  it('still logs and navigates when GPS capture fails (resolves to null)', async () => {
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockCapture).toHaveBeenCalled()
    expect(logException).toHaveBeenCalledWith(
      'panic_button',
      expect.objectContaining({ gpsLat: null, gpsLng: null }),
    )
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.panicSubmitted)
  })

  // Fix 2 (panic over-promise): when the backend call fails, the alert is queued
  // on-device instead of silently lost — and PanicSubmittedPageClient must be told so
  // it doesn't claim the dispatcher was notified when nothing has actually sent.
  it('queues the alert and navigates with the queued flag when logException fails', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue({ latitude: -26.09, longitude: 28.13, accuracy: 5 })

    render(<PanicPage />)
    confirmPanicSwipe()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // The queued body must carry the captured GPS pair too — a retry that sends
    // without location would break the page's "location will be included" promise
    // precisely in the offline case panic queuing exists for.
    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
      gps_lat: -26.09,
      gps_lng: 28.13,
    })
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.panicSubmittedUrl(true))
    expect(mockRouterReplace).toHaveBeenCalledWith(`${ROUTES.panicSubmitted}?queued=1`)
  })

  it('queued body omits GPS entirely when capture failed — never a partial fix', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // No gps_lat/gps_lng keys at all — the backend 422s a partial fix, which would
    // make the offline queue drop the panic entry as a terminal failure.
    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
    })
  })

  it('queued body carries the phase the driver was on, captured before the queue wait', async () => {
    // The regression this whole change exists for. This entry can sit in the queue until
    // signal returns — possibly after the driver has arrived and the trip has advanced —
    // so the phase has to be resolved NOW, at the press, not at flush time. Without it
    // the alert lands untagged and the dispatcher infers placement on every render,
    // which is what made a 15:17 panic appear to walk forward through the timeline.
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    // Everything through departure resolved: the ledger sits on the PENDING in_transit
    // row for the whole drive, which is exactly where a panic on the road belongs.
    const phases = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const inTransit = phases.find((p) => p.phase_type === 'in_transit')!
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123', phases }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
      phase_event_id: String(inTransit.phase_event_id),
    })
  })

  it('still queues the alert when the trip carries no phase plan at all', async () => {
    // Defensive: this runs inside the catch block of an already-failed send. A throw
    // here would lose the panic AND strand the driver on this screen. Untagged is a
    // small loss; unsent is the whole failure.
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
    })
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.panicSubmittedUrl(true))
  })
})
