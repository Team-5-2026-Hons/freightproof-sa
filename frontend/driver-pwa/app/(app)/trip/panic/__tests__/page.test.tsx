import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PanicPage from '../page'
import { ROUTES } from '@/lib/constants/routes'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { REPORT_CAPTURE_BUDGET_MS } from '@/lib/utils/bounded-capture'

const FIX = { latitude: -26.09, longitude: 28.13, accuracy: 5, capturedAt: '2026-09-16T10:00:00.000Z' }

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

const mockUseTrip = vi.fn()
const mockRouterBack = vi.fn()
const mockRouterReplace = vi.fn()

const mockCapture = vi.fn()

const mockEnqueueException = vi.fn()

/** The sent/saved screen's URL the panic page navigated to, as parameters. */
function submittedParams(): URLSearchParams {
  const url = mockRouterReplace.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith(ROUTES.panicSubmitted))
  expect(url).toBeDefined()
  return new URL(url!, 'http://local').searchParams
}

/** Navigated to the sent screen — not the queued one — with this alert's own receipt. */
function expectSentReceipt(): void {
  const params = submittedParams()
  expect(params.has('queued')).toBe(false)
  expect(params.get('at')).toEqual(expect.any(String))
}

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
    mockCapture.mockResolvedValue(FIX)
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

  it('fallback "Back to In Transit" button uses router.replace, not router.back', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: false, logException: vi.fn() })

    render(<PanicPage />)
    fireEvent.click(screen.getByText(/back to in transit/i))

    expect(mockRouterReplace).toHaveBeenCalledWith(ROUTES.inTransit)
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('renders a spinner (not a blank screen) while the trip is loading', () => {
    mockUseTrip.mockReturnValue({ trip: null, isLoading: true, logException: vi.fn() })

    render(<PanicPage />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/send panic/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unable to verify trip/i)).not.toBeInTheDocument()
  })

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
    mockEnqueueException.mockReturnValue({ persisted: true, photoPersisted: false })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function confirmPanicSwipe() {
    const slider = screen.getByRole('slider', { name: /send panic/i })

    fireEvent.keyDown(slider, { key: 'Enter' })
    fireEvent.keyDown(slider, { key: 'Enter' })

    act(() => {
      vi.advanceTimersByTime(180)
    })
  }

  async function settlePanic(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPORT_CAPTURE_BUDGET_MS)
    })
  }

  it('captures GPS within the budget and sends the alert with the fix attached', async () => {
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(FIX)

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(mockCapture).toHaveBeenCalled()
    expect(logException).toHaveBeenCalledWith(
      'panic_button',
      expect.objectContaining({
        description: 'Driver activated panic button.',
        gpsLat: -26.09, gpsLng: 28.13,
        driverCapturedAt: FIX.capturedAt, driverAccuracyMetres: 5,
      }),
    )
    expectSentReceipt()
  })

  it('still logs and navigates when location capture is unavailable', async () => {
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(mockCapture).toHaveBeenCalled()
    expect(logException).toHaveBeenCalledWith(
      'panic_button',
      expect.objectContaining({ description: 'Driver activated panic button.', gpsLat: null, gpsLng: null }),
    )
    expectSentReceipt()
  })

  it('does not wait for a stalled location adapter beyond the capture budget', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockReturnValue(new Promise(() => {}))

    render(<PanicPage />)
    confirmPanicSwipe()

    await act(async () => { await vi.advanceTimersByTimeAsync(REPORT_CAPTURE_BUDGET_MS - 1) })
    expect(logException).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })

    expect(logException).toHaveBeenCalledWith(
      'panic_button', expect.objectContaining({ description: 'Driver activated panic button.', gpsLat: null, gpsLng: null }),
    )
    expectSentReceipt()
  })

  it('queues the alert and navigates with the queued flag when logException fails', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(FIX)

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
      client_report_id: expect.any(String),
      gps_lat: -26.09,
      gps_lng: 28.13,
      driver_captured_at: FIX.capturedAt,
      driver_accuracy_metres: 5,
    })
    const livePayload = logException.mock.calls[0][1] as { clientReportId: string }
    const queuedBody = mockEnqueueException.mock.calls[0][1] as { client_report_id: string }
    expect(queuedBody.client_report_id).toBe(livePayload.clientReportId)
    expect(mockRouterReplace).toHaveBeenCalledWith(expect.stringContaining('queued=1'))
    expect(mockRouterReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/trip\/panic\/submitted\?/))
  })

  it('shows that the alert was not saved when local storage refuses it', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(FIX)
    mockEnqueueException.mockReturnValue({ persisted: false, photoPersisted: false })

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(screen.getByRole('alert')).toHaveTextContent(/alert was not sent or saved/i)
    expect(mockRouterReplace).not.toHaveBeenCalledWith(expect.stringContaining('queued=1'))
  })

  it('queued body omits GPS entirely when capture failed — never a partial fix', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
      client_report_id: expect.any(String),
    })
  })

  it('queued body carries the phase the driver was on, captured before the queue wait', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    const phases = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const inTransit = phases.find((p) => p.phase_type === 'in_transit')!
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123', phases }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
      phase_event_id: String(inTransit.phase_event_id),
      client_report_id: expect.any(String),
    })
  })

  it('still queues the alert when the trip carries no phase plan at all', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    confirmPanicSwipe()

    await settlePanic()

    expect(mockEnqueueException).toHaveBeenCalledWith('trip-123', {
      exception_type: 'panic_button',
      description: 'Driver activated panic button.',
      client_report_id: expect.any(String),
    })
    expect(mockRouterReplace).toHaveBeenCalledWith(expect.stringContaining('queued=1'))
  })
})

describe('PanicPage — the overhauled screen (7.1, 7.1b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueueException.mockReturnValue({ persisted: true, photoPersisted: false })
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  })

  it('test_is_a_white_page_with_one_red_control', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123', trip_reference: 'TRP-2026-0041' }, isLoading: false, logException: vi.fn() })
    mockCapture.mockReturnValue(new Promise(() => {}))

    render(<PanicPage />)

    expect(screen.getByRole('main')).not.toHaveClass('bg-error')
    expect(screen.getByRole('slider', { name: /send panic/i })).toHaveClass('bg-error')
  })

  it('test_says_it_is_finding_the_location_then_that_it_found_it', async () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123', trip_reference: 'TRP-2026-0041' }, isLoading: false, logException: vi.fn() })
    let resolveFix: (fix: typeof FIX) => void = () => {}
    mockCapture.mockReturnValue(new Promise((resolve) => { resolveFix = resolve }))

    render(<PanicPage />)
    expect(screen.getByText('Finding…')).toBeInTheDocument()
    await act(async () => { resolveFix(FIX) })

    expect(screen.getByText('Found')).toBeInTheDocument()
    expect(screen.getByText('TRP-2026-0041')).toBeInTheDocument()
  })

  it('test_pulses_red_while_the_finger_is_down_and_stops_when_it_lifts', () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123', trip_reference: 'TRP-2026-0041' }, isLoading: false, logException: vi.fn() })
    mockCapture.mockReturnValue(new Promise(() => {}))
    render(<PanicPage />)
    const slider = screen.getByRole('slider', { name: /send panic/i })
    expect(document.querySelector('[data-panic-pulse]')).toBeNull()

    fireEvent.pointerDown(slider, { clientX: 0, pointerId: 1 })

    const pulse = document.querySelector('[data-panic-pulse]')
    expect(pulse).not.toBeNull()
    expect(pulse).toHaveClass('pointer-events-none')
    expect(screen.getByText('Keep going. Let go to cancel.')).toBeInTheDocument()

    fireEvent.pointerUp(slider, { clientX: 5, pointerId: 1 })

    expect(document.querySelector('[data-panic-pulse]')).toBeNull()
    expect(screen.queryByText('Keep going. Let go to cancel.')).toBeNull()
  })
})

describe('PanicPage — the receipt it hands on (7.2/7.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueueException.mockReturnValue({ persisted: true, photoPersisted: false })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function sendPanic(): Promise<void> {
    const slider = screen.getByRole('slider', { name: /send panic/i })
    fireEvent.keyDown(slider, { key: 'Enter' })
    fireEvent.keyDown(slider, { key: 'Enter' })
    act(() => { vi.advanceTimersByTime(180) })
    await act(async () => { await vi.advanceTimersByTimeAsync(REPORT_CAPTURE_BUDGET_MS) })
  }

  it('test_says_the_location_went_with_the_alert_when_it_did', async () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException: vi.fn() })
    mockCapture.mockResolvedValue(FIX)

    render(<PanicPage />)
    await sendPanic()

    expect(submittedParams().get('loc')).toBe('1')
  })

  it('test_says_no_location_went_when_none_was_found', async () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-123' }, isLoading: false, logException: vi.fn() })
    mockCapture.mockResolvedValue(null)

    render(<PanicPage />)
    await sendPanic()

    expect(submittedParams().get('loc')).toBe('0')
  })
})
