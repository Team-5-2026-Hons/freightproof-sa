import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LogExceptionPageClient from '../LogExceptionPageClient'
import { REPORT_CAPTURE_BUDGET_MS } from '@/lib/utils/bounded-capture'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

const PHOTO_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const REQUIRED_DESCRIPTION = 'Driver observed an issue'

const RIGID_TRIP = { id: 'trip-1', trailers: [] }
const FRONT_TRAILER = { id: 'trailer-front', registration: 'TRL 111 GP' }
const REAR_TRAILER = { id: 'trailer-rear', registration: 'TRL 222 GP' }
const SINGLE_TRAILER_TRIP = { ...RIGID_TRIP, trailers: [FRONT_TRAILER] }
const INTERLINK_TRIP = { ...RIGID_TRIP, trailers: [FRONT_TRAILER, REAR_TRAILER] }

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterBack = vi.fn()
const mockNotify = vi.fn()
const mockSubmitExceptionReport = vi.fn()
const mockCaptureLocation = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack, replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useLocation', () => ({
  useLocation: () => ({ capture: mockCaptureLocation }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ submitExceptionReport: mockSubmitExceptionReport }),
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

let captureCounter = 0
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, dataUrl, onCapture }: {
    label: string
    dataUrl: string | null
    onCapture: (dataUrl: string) => void
  }) => (
    <div>
      <button onClick={() => { captureCounter += 1; onCapture(`${PHOTO_DATA_URL}#${captureCounter}`) }}>{label}</button>
      {dataUrl ? <img alt={`captured ${label}`} src={dataUrl} /> : null}
    </div>
  ),
}))

beforeEach(() => {
  captureCounter = 0
  mockCaptureLocation.mockResolvedValue(null)
})

/**
 * Drives the page the way the real hook does: calls the page's `post` closure with one
 * artifact id per photo, then maps the result onto the same outcomes the hook returns.
 * `deviceFull` makes a failed send unstorable (the hook's non-durable path).
 */
function hookBehaviour({ deviceFull = false }: { deviceFull?: boolean } = {}) {
  mockSubmitExceptionReport.mockImplementation(async (draft: { photos: unknown[] }, post: (ids: string[]) => Promise<unknown>) => {
    try {
      await post(draft.photos.map((_, i) => `artifact-${i + 1}`))
      return { kind: 'acknowledged' }
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        return { kind: 'rejected', reason: err.message, photoIndex: null }
      }
      return deviceFull
        ? { kind: 'not-saved', photoCount: draft.photos.length }
        : { kind: 'saved-for-later' }
    }
  })
}

/** The draft the page handed to submitExceptionReport on its first call. */
function firstDraft() {
  return mockSubmitExceptionReport.mock.calls[0][0] as {
    tripId: string
    clientReportId: string
    body: Record<string, unknown>
    photos: Array<{ id: string; dataUrl: string; capturedAt: string }>
  }
}

/** The ordered photo list (the footer checklist is a list too, so filter by tag). */
function photoList(): HTMLElement | undefined {
  return screen.queryAllByRole('list').find((el) => el.tagName === 'OL')
}

/** Taps the add row (labelled by its verb) once. */
function addPhoto() {
  const add = screen.queryByRole('button', { name: 'Add a photo' }) ?? screen.getByRole('button', { name: 'Add another photo' })
  fireEvent.click(add)
}

function enterRequiredDescription(value = REQUIRED_DESCRIPTION) {
  fireEvent.change(screen.getByLabelText('Describe what happened'), { target: { value } })
}

describe('LogExceptionPageClient required description', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCaptureLocation.mockResolvedValue(null)
    hookBehaviour()
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
  })

  it('keeps submit disabled until the driver enters visible description text', () => {
    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))

    const submit = screen.getByText('Submit Exception')
    expect(screen.getByLabelText('Describe what happened')).toBeRequired()
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Describe what happened'), { target: { value: '   ' } })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Describe what happened'), {
      target: { value: 'Pallet crushed at rear door' },
    })
    expect(submit).toBeEnabled()
  })
})

describe('LogExceptionPageClient submit receipt (5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookBehaviour()
  })

  it('fires a success toast naming the chosen category, then navigates to the hub', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String),
    })
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Exception recorded',
        body: expect.stringContaining('Cargo damage'),
      }),
    )
  })

  it('does not fire a success toast on a terminal 4xx failure; shows the inline error instead', async () => {
    const logException = vi.fn().mockRejectedValue(new ApiError(422, 'invalid'))
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Vehicle breakdown'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(screen.getByText(/could not submit/i)).toBeInTheDocument())
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('LogExceptionPageClient failure feedback (audit fixes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookBehaviour()
  })

  it('on a network failure, queues the exception, fires the saved-on-device toast, and advances to the hub', async () => {
    const logException = vi.fn().mockRejectedValue(new TypeError('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockSubmitExceptionReport).toHaveBeenCalledWith(
      {
        tripId: 'trip-1',
        clientReportId: expect.any(String),
        body: {
          exception_type: 'cargo_damage',
          description: REQUIRED_DESCRIPTION,
          client_report_id: expect.any(String),
        },
        photos: [],
      },
      expect.any(Function),
      expect.any(Function),
    )
    const livePayload = logException.mock.calls[0][1] as { clientReportId: string }
    expect(firstDraft().body.client_report_id).toBe(livePayload.clientReportId)
    expect(firstDraft().clientReportId).toBe(livePayload.clientReportId)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Report saved',
        body: expect.stringContaining('sync'),
      }),
    )
  })

  it('queues the exception when the API client reports a status-0 timeout', async () => {
    const logException = vi.fn().mockRejectedValue(new ApiError(0, 'request timed out'))
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockSubmitExceptionReport).toHaveBeenCalled()
    expect(screen.queryByText(/the report was not accepted/i)).not.toBeInTheDocument()
  })

  it('shows honest not-accepted copy (not connection copy) on a terminal 4xx', async () => {
    const logException = vi.fn().mockRejectedValue(new ApiError(422, 'invalid'))
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() =>
      expect(screen.getByText(/the report was not accepted/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument()
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('LogExceptionPageClient back link (5d)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookBehaviour()
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
  })

  it('shows an "In Transit" back target (SubpageHeader) that pushes the hub route (not router.back)', () => {
    render(<LogExceptionPageClient />)

    const backLink = screen.getByRole('button', { name: 'Back to In Transit' })
    expect(backLink).toHaveClass('min-h-[44px]')

    fireEvent.click(backLink)

    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
    expect(mockRouterBack).not.toHaveBeenCalled()
  })
})

describe('LogExceptionPageClient phase tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCaptureLocation.mockResolvedValue(null)
    hookBehaviour()
  })

  it('queues a breakdown against the leg being driven, resolved at report time', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('offline'))
    const phases = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const inTransit = phases.find((p) => p.phase_type === 'in_transit')!
    mockUseTrip.mockReturnValue({ trip: { ...RIGID_TRIP, phases }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Vehicle breakdown'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    expect(firstDraft().body).toEqual({
      exception_type: 'mechanical',
      description: REQUIRED_DESCRIPTION,
      phase_event_id: String(inTransit.phase_event_id),
      client_report_id: expect.any(String),
      vehicle_type: 'horse',
    })
  })

  it('still queues the report when the trip carries no phase plan', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('offline'))
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Seal broken in transit'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    expect(firstDraft().body).toEqual({
      exception_type: 'seal_broken_in_transit', description: REQUIRED_DESCRIPTION,
      client_report_id: expect.any(String),
    })
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
  })
})

describe('LogExceptionPageClient location capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookBehaviour()
  })

  it('forwards the original phone capture metadata to both direct and queued reports', async () => {
    const logException = vi.fn().mockRejectedValue(new Error('offline'))
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })
    mockCaptureLocation.mockResolvedValue({
      latitude: -26.0942, longitude: 28.1342, accuracy: 5,
      capturedAt: '2026-09-15T10:00:00Z',
    })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('cargo_damage', expect.objectContaining({
      gpsLat: -26.0942, gpsLng: 28.1342,
      driverCapturedAt: '2026-09-15T10:00:00Z', driverAccuracyMetres: 5,
    }))
    expect(firstDraft().body).toEqual(expect.objectContaining({
      gps_lat: -26.0942, gps_lng: 28.1342,
      driver_captured_at: '2026-09-15T10:00:00Z', driver_accuracy_metres: 5,
    }))
  })

  it('sends the report without a fix once the capture budget elapses, never waiting on a stalled GPS', async () => {
    vi.useFakeTimers()
    try {
      const logException = vi.fn().mockResolvedValue(undefined)
      mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })
      mockCaptureLocation.mockReturnValue(new Promise(() => {}))

      render(<LogExceptionPageClient />)
      fireEvent.click(screen.getByText('Cargo damage'))
      enterRequiredDescription()
      fireEvent.click(screen.getByText('Submit Exception'))

      await act(async () => { await vi.advanceTimersByTimeAsync(REPORT_CAPTURE_BUDGET_MS - 1) })
      expect(logException).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(1) })

      expect(logException).toHaveBeenCalledWith('cargo_damage', expect.not.objectContaining({ gpsLat: expect.anything() }))
      expect(logException).toHaveBeenCalledWith('cargo_damage', expect.objectContaining({ description: expect.any(String) }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('a second tap during the location wait does not start a second submission', async () => {
    let resolveFix: (fix: null) => void = () => {}
    mockCaptureLocation.mockReturnValue(new Promise((resolve) => { resolveFix = resolve }))
    hookBehaviour()
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn().mockResolvedValue(undefined) })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    enterRequiredDescription()
    fireEvent.click(screen.getByText('Submit Exception'))
    fireEvent.click(screen.getByText('Submit Exception'))
    await act(async () => { resolveFix(null) })

    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalledTimes(1))
  })
})

describe('LogExceptionPageClient asks which vehicle broke down', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookBehaviour()
  })

  function chooseBreakdown() {
    fireEvent.click(screen.getByText('Vehicle breakdown'))
    enterRequiredDescription()
  }

  it('asks nothing on a rigid truck and records the breakdown against the truck', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    expect(screen.queryByText('Which vehicle broke down?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('mechanical', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String), vehicleType: 'horse',
    })
  })

  it('asks Truck or Trailer on a one-trailer trip, and sends no trailer id for the trailer', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: SINGLE_TRAILER_TRIP, logException })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    expect(screen.getByText('Truck')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Trailer'))
    expect(screen.queryByText(FRONT_TRAILER.registration)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('mechanical', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String), vehicleType: 'trailer',
    })
  })

  it('lists each trailer plate on an interlink and sends the chosen trailer', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: INTERLINK_TRIP, logException })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    fireEvent.click(screen.getByText('Trailer'))
    expect(screen.getByText(FRONT_TRAILER.registration)).toBeInTheDocument()
    fireEvent.click(screen.getByText(REAR_TRAILER.registration))
    expect(screen.getByRole('radio', { name: 'Trailer' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: REAR_TRAILER.registration })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('mechanical', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String),
      vehicleType: 'trailer', trailerId: REAR_TRAILER.id,
    })
  })

  it('drops the plate when the driver switches back to the truck', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: INTERLINK_TRIP, logException })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    fireEvent.click(screen.getByText('Trailer'))
    fireEvent.click(screen.getByText(REAR_TRAILER.registration))
    fireEvent.click(screen.getByText('Truck'))
    expect(screen.queryByText(REAR_TRAILER.registration)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('mechanical', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String), vehicleType: 'horse',
    })
  })

  it('keeps submit disabled until the vehicle, and on an interlink the plate, is chosen', () => {
    mockUseTrip.mockReturnValue({ trip: INTERLINK_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    const submit = screen.getByText('Submit Exception')

    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByText('Trailer'))
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByText(FRONT_TRAILER.registration))
    expect(submit).toBeEnabled()
  })

  it('clears the answer when the driver picks another category, which sends neither field', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: INTERLINK_TRIP, logException })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    fireEvent.click(screen.getByText('Trailer'))
    fireEvent.click(screen.getByText(REAR_TRAILER.registration))
    fireEvent.click(screen.getByRole('button', { name: /change what happened/i }))
    fireEvent.click(screen.getByText('Cargo damage'))
    expect(screen.queryByText('Which vehicle broke down?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /change what happened/i }))
    fireEvent.click(screen.getByText('Vehicle breakdown'))
    expect(screen.getByText('Submit Exception')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /change what happened/i }))
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String),
    })
  })

  it('keeps the answer in the queued body when the report goes offline', async () => {
    const logException = vi.fn().mockRejectedValue(new TypeError('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: INTERLINK_TRIP, logException })

    render(<LogExceptionPageClient />)
    chooseBreakdown()
    fireEvent.click(screen.getByText('Trailer'))
    fireEvent.click(screen.getByText(REAR_TRAILER.registration))
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    expect(firstDraft().body).toEqual({
      exception_type: 'mechanical',
      description: REQUIRED_DESCRIPTION,
      client_report_id: expect.any(String),
      vehicle_type: 'trailer',
      trailer_id: REAR_TRAILER.id,
    })
  })
})

function fillForm() {
  fireEvent.click(screen.getByText('Cargo damage'))
  enterRequiredDescription()
}

describe('LogExceptionPageClient photo capture (FP-290)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookBehaviour()
  })

  it('test_count_not_shown_with_zero_photos', () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)

    expect(screen.queryByText(/\d of \d/)).not.toBeInTheDocument()
    expect(photoList()).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Add a photo' })).toBeInTheDocument()
  })

  it('shows each captured photo back to the driver, in order, before they submit', () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    addPhoto()
    addPhoto()

    const first = screen.getByAltText('captured Photo 1')
    const second = screen.getByAltText('captured Photo 2')
    expect(first).toHaveAttribute('src', `${PHOTO_DATA_URL}#1`)
    expect(second).toHaveAttribute('src', `${PHOTO_DATA_URL}#2`)
    expect(screen.getByText('2 of 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add another photo' })).toBeInTheDocument()
  })

  it('test_two_photos_reach_submit_in_order_with_one_client_report_id', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    const draft = firstDraft()
    expect(draft.photos.map((p) => p.dataUrl)).toEqual([`${PHOTO_DATA_URL}#1`, `${PHOTO_DATA_URL}#2`])
    expect(new Set(draft.photos.map((p) => p.id)).size).toBe(2)
    expect(draft.photos.every((p) => p.capturedAt.length > 0)).toBe(true)
    expect(draft.tripId).toBe('trip-1')
    expect(draft.body.client_report_id).toBe(draft.clientReportId)
    expect(mockSubmitExceptionReport).toHaveBeenCalledTimes(1)
    expect(logException).toHaveBeenCalledTimes(1)
  })

  it('names the category and the photo count in the success toast', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn().mockResolvedValue(undefined) })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockNotify).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      title: 'Exception recorded',
      body: expect.stringContaining('Cargo damage with 2 photos'),
    }))
  })

  it('test_post_closure_sends_complete_id_list_to_logException', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'acknowledged' })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))
    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    const post = mockSubmitExceptionReport.mock.calls[0][1] as (ids: string[]) => Promise<unknown>

    await post(['artifact-a', 'artifact-b'])

    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: REQUIRED_DESCRIPTION,
      clientReportId: firstDraft().clientReportId,
      supporting_artifact_ids: ['artifact-a', 'artifact-b'],
    })
  })

  it('test_photoless_report_posts_no_ids', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'acknowledged' })

    render(<LogExceptionPageClient />)
    fillForm()
    fireEvent.click(screen.getByText('Submit Exception'))
    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    const post = mockSubmitExceptionReport.mock.calls[0][1] as (ids: string[]) => Promise<unknown>

    await post([])

    expect(firstDraft().photos).toEqual([])
    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: REQUIRED_DESCRIPTION, clientReportId: expect.any(String),
    })
  })

  it('test_client_report_id_is_stable_across_resubmits_after_failure', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport
      .mockResolvedValueOnce({ kind: 'not-saved', photoCount: 1 })
      .mockResolvedValueOnce({ kind: 'acknowledged' })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByText('Submit Exception'))
    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalledTimes(2))

    const [first, second] = mockSubmitExceptionReport.mock.calls.map((c) => c[0] as ReturnType<typeof firstDraft>)
    expect(second.clientReportId).toBe(first.clientReportId)
    expect(second.body.client_report_id).toBe(first.body.client_report_id)
    expect(second.photos.map((p) => p.id)).toEqual(first.photos.map((p) => p.id))
  })

  it('test_add_control_hidden_at_five_photos_and_count_reads_5_of_5', () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    for (let i = 0; i < 5; i += 1) addPhoto()

    expect(screen.getByText('5 of 5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add another photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a photo' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^Photo \d$/ })).toHaveLength(5)
  })

  it('test_remove_photo_drops_that_slot_and_shows_add_again', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn().mockResolvedValue(undefined) })

    render(<LogExceptionPageClient />)
    fillForm()
    for (let i = 0; i < 5; i += 1) addPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }))

    expect(screen.getByText('4 of 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add another photo' })).toBeInTheDocument()
    expect(screen.getByAltText('captured Photo 2')).toHaveAttribute('src', `${PHOTO_DATA_URL}#3`)
    fireEvent.click(screen.getByText('Submit Exception'))
    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalled())
    expect(firstDraft().photos.map((p) => p.dataUrl)).toEqual([1, 3, 4, 5].map((n) => `${PHOTO_DATA_URL}#${n}`))
  })

  it('test_retake_replaces_only_that_slot_with_a_new_photo_id', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn().mockResolvedValue(undefined) })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))
    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalledTimes(1))
    const before = firstDraft().photos
    mockRouterPush.mockClear()

    fireEvent.click(within(screen.getByRole('group', { name: 'Photo 2' })).getByRole('button', { name: 'Photo 2' }))
    fireEvent.click(screen.getByText('Submit Exception'))
    await waitFor(() => expect(mockSubmitExceptionReport).toHaveBeenCalledTimes(2))

    const after = (mockSubmitExceptionReport.mock.calls[1][0] as ReturnType<typeof firstDraft>).photos
    expect(after).toHaveLength(3)
    expect(after[0]).toEqual(before[0])
    expect(after[2]).toEqual(before[2])
    expect(after[1].id).not.toBe(before[1].id)
    expect(after[1].dataUrl).toBe(`${PHOTO_DATA_URL}#4`)
    expect(screen.getByText('3 of 5')).toBeInTheDocument()
  })

  it('gives every photo group and remove button an accessible name', () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    addPhoto()
    addPhoto()

    const list = photoList() as HTMLElement
    expect(list).toBeDefined()
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    for (const n of [1, 2]) {
      const group = screen.getByRole('group', { name: `Photo ${n}` })
      const remove = within(group).getByRole('button', { name: `Remove photo ${n}` })
      expect(remove).toHaveClass('size-11')
      expect(remove).not.toHaveTextContent(/\S/)
    }
  })

  it('test_no_horizontal_overflow_risk_classes_in_the_photo_list', () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    for (let i = 0; i < 5; i += 1) addPhoto()

    const list = photoList() as HTMLElement
    expect(list).toHaveClass('min-w-0')
    const fixedWidths = [...list.outerHTML.matchAll(/\bw-\[(\d+)px\]/g)].map((m) => Number(m[1]))
    expect(fixedWidths.filter((w) => w > 300)).toEqual([])
  })

  it('test_submit_disabled_label_unchanged_while_chips_say_whats_missing', () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    addPhoto()

    expect(screen.getByText('Submit Exception')).toBeDisabled()
    const list = screen.getByRole('list', { name: 'Needed to continue' })
    expect(list).toHaveTextContent('What happened')
    expect(list).toHaveTextContent('Description')
  })

  it('shows "Uploading Photos…" while photos are on their way and "Submitting…" once they are up', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    let finish: (v: { kind: 'acknowledged' }) => void = () => {}
    let progress: (u: number, t: number) => void = () => {}
    mockSubmitExceptionReport.mockImplementation((_d: unknown, _p: unknown, onProgress: typeof progress) => {
      progress = onProgress
      return new Promise((resolve) => { finish = resolve })
    })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    expect(await screen.findByText('Uploading Photos…')).toBeDisabled()
    act(() => progress(1, 1))
    expect(screen.getByText('Submitting…')).toBeInTheDocument()
    await act(async () => { finish({ kind: 'acknowledged' }) })
  })

  it('test_saved_for_later_toast_states_stored_on_device_and_navigates', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'saved-for-later' })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockNotify).toHaveBeenCalledWith({
      kind: 'success',
      title: 'Report saved',
      body: 'Report and 2 photos stored on this device. They sync when you’re back online.',
    })
  })

  it('says the report alone is stored when there are no photos', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'saved-for-later' })

    render(<LogExceptionPageClient />)
    fillForm()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Report saved',
      body: 'Stored on this device. It will sync when you’re back online.',
    })))
  })

  it('test_not_saved_keeps_form_open_and_names_what_was_not_saved', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'not-saved', photoCount: 2 })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no room to store it/i)
    expect(alert).toHaveTextContent('Not saved: the description and 2 photos.')
    expect(alert).toHaveTextContent('Nothing was lost from this screen')
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Report saved' }))
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Describe what happened')).toHaveValue(REQUIRED_DESCRIPTION)
    expect(screen.getByText('2 of 5')).toBeInTheDocument()
    expect(screen.getByText('Submit Exception')).toBeEnabled()
  })

  it('names only the description when a photo-free report cannot be stored', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'not-saved', photoCount: 0 })

    render(<LogExceptionPageClient />)
    fillForm()
    fireEvent.click(screen.getByText('Submit Exception'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: the description.')
  })

  it('test_rejected_photo_names_photo_number_and_keeps_form', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'rejected', reason: 'too large', photoIndex: 1 })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Photo 2 was not accepted by the server. Remove or retake it, then submit again.')
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.getByText('2 of 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('test_rejected_report_shows_existing_not_accepted_copy', async () => {
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
    mockSubmitExceptionReport.mockResolvedValue({ kind: 'rejected', reason: 'invalid', photoIndex: null })

    render(<LogExceptionPageClient />)
    fillForm()
    addPhoto()
    fireEvent.click(screen.getByText('Submit Exception'))

    expect(await screen.findByText(/the report was not accepted/i)).toBeInTheDocument()
    expect(screen.queryByText(/Photo \d was not accepted/)).not.toBeInTheDocument()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('says nothing was saved when the device cannot store the report at all', async () => {
    mockUseTrip.mockReturnValue({
      trip: RIGID_TRIP,
      logException: vi.fn().mockRejectedValue(new TypeError('network unreachable')),
    })
    hookBehaviour({ deviceFull: true })

    render(<LogExceptionPageClient />)
    fillForm()
    fireEvent.click(screen.getByText('Submit Exception'))

    await waitFor(() => expect(screen.getByText(/no room to store it/i)).toBeInTheDocument())
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Report saved' }))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('LogExceptionPageClient — what is still needed (audit C4)', () => {
  it('lists the requirements beside the submit, not a stray "Required" under the description', () => {
    render(<LogExceptionPageClient />)

    expect(screen.queryByText('Required')).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Needed to continue' })
    expect(list).toHaveTextContent('What happened')
    expect(list).toHaveTextContent('Description')
  })
})

describe('LogExceptionPageClient — the category list (overhaul 6.3/6.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: RIGID_TRIP, logException: vi.fn() })
  })

  it('test_offers_every_category_as_a_radio', () => {
    render(<LogExceptionPageClient />)

    const group = screen.getByRole('radiogroup', { name: 'What happened' })

    expect(within(group).getAllByRole('radio')).toHaveLength(5)
  })

  it('test_collapses_to_the_chosen_category_with_a_way_to_change_it', () => {
    render(<LogExceptionPageClient />)

    fireEvent.click(screen.getByText('Cargo damage'))

    expect(screen.queryByRole('radiogroup', { name: 'What happened' })).toBeNull()
    expect(screen.getByText('Cargo damage')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change what happened/i })).toBeInTheDocument()
  })

  it('test_reopens_the_list_with_the_choice_still_marked', () => {
    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))

    fireEvent.click(screen.getByRole('button', { name: /change what happened/i }))

    expect(screen.getByRole('radio', { name: 'Cargo damage' })).toHaveAttribute('aria-checked', 'true')
  })
})
