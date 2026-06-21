// frontend/driver-pwa/app/(app)/trip/[id]/panic/__tests__/page.test.tsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PanicPage from '../page'
import { ROUTES } from '@/lib/constants/routes'

// `trip` is provided to PanicPage via useTrip() (session-derived), independent
// of the URL's tripId param — these tests verify the page-level guard that
// catches a mismatch between the two before the panic action is reachable.
const mockUseParams = vi.fn()
const mockUseTrip = vi.fn()
const mockRouterBack = vi.fn()
const mockRouterReplace = vi.fn()

// `capture` is reassigned per-test (success vs. GPS-failure payloads) for the
// handlePanic sequencing tests below — declared here so the module mock can
// reference a mutable function.
const mockCapture = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
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

describe('PanicPage trip-mismatch guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapture.mockResolvedValue({ latitude: -26.09, longitude: 28.13, accuracy: 5 })
  })

  it('renders an unavailable state and no hold button when trip is null', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: null, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByText(/unable to verify trip/i)).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
  })

  it('renders an unavailable state and no hold button when trip.id does not match the URL tripId', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-999' }, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByText(/unable to verify trip/i)).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
  })

  it('renders the normal panic UI with the hold button when trip.id matches the URL tripId', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.queryByText(/unable to verify trip/i)).not.toBeInTheDocument()
    expect(screen.getByText(/send panic/i)).toBeInTheDocument()
  })

  it('fallback "Return to in-transit" button uses router.replace, not router.back', () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    mockUseTrip.mockReturnValue({ trip: null, logException: vi.fn() })

    render(<PanicPage />)
    fireEvent.click(screen.getByText(/return to in-transit/i))

    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.inTransit('trip-123'))
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
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, logException })
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
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.panicSubmitted('trip-123'))
  })

  it('still logs and navigates when GPS capture fails (resolves to null)', async () => {
    mockUseParams.mockReturnValue({ id: 'trip-123' })
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, logException })
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
    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.panicSubmitted('trip-123'))
  })
})
