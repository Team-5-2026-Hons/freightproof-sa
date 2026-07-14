import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PanicPage from '../page'
import { ROUTES } from '@/lib/constants/routes'

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

  it('renders an unavailable state and no hold button when trip is null', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByText(/unable to verify trip/i)).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
  })

  it('renders the normal panic UI with the hold button when a trip is present', () => {
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
})

describe('PanicPage handlePanic sequencing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // HoldButton's onConfirm only fires once useHoldToConfirm's internal
  // interval reports full progress, so we drive the actual pointer-hold
  // interaction (pointerdown + advance fake timers past durationMs) rather
  // than reaching into HoldButton internals — this exercises the same path
  // a real driver triggers.
  function pressAndHoldPanicButton() {
    const holdButton = screen.getByText(/send panic/i).closest('button')
    if (!holdButton) throw new Error('panic hold button not found')

    fireEvent.pointerDown(holdButton)
    act(() => {
      // durationMs is 3000; advance slightly past it so the interval's
      // progress check (Date.now() - start >= durationMs) reliably crosses
      // the threshold rather than landing exactly on a boundary tick.
      vi.advanceTimersByTime(3200)
    })
  }

  it('captures GPS, logs the exception with coords, and navigates to panic/submitted', async () => {
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue({ latitude: -26.09, longitude: 28.13, accuracy: 5 })

    render(<PanicPage />)
    pressAndHoldPanicButton()

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
    pressAndHoldPanicButton()

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
    pressAndHoldPanicButton()

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
    expect(mockRouterReplace).toHaveBeenCalledWith(`${ROUTES.panicSubmitted}?queued=1`)
  })
})
