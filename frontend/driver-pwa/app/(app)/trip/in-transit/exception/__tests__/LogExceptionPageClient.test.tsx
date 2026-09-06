import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LogExceptionPageClient from '../LogExceptionPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// Marks every phase up to and including `through` (by sequence_number) as completed —
// same local helper lib/phase/__tests__/derive.test.ts uses.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

const PHOTO_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterBack = vi.fn()
const mockNotify = vi.fn()
const mockEnqueueException = vi.fn()
const mockUploadNow = vi.fn()
const mockUploadArtifact = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack, replace: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueueException: mockEnqueueException }),
}))

vi.mock('@/lib/hooks/useArtifactUpload', () => ({
  useArtifactUpload: () => ({ uploadNow: mockUploadNow }),
}))

vi.mock('@/lib/api/artifacts', () => ({
  uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
}))

// Button is being reworked in a parallel task — stub it so this suite only
// exercises the page's own behavior, not Button internals.
vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

// Stubbed for the same reason as Button: CameraCapture's own capture paths are covered
// in components/phase/__tests__/CameraCapture.test.tsx. Here it only needs to be a thing
// that hands the page a data URL and shows what the page passes back down.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, dataUrl, onCapture }: {
    label: string
    dataUrl: string | null
    onCapture: (dataUrl: string) => void
  }) => (
    <div>
      <button onClick={() => onCapture(PHOTO_DATA_URL)}>{label}</button>
      {dataUrl ? <img alt="captured photo" src={dataUrl} /> : null}
    </div>
  ),
}))

/** Default queue behaviour: the write lands, photo included where one was passed. */
function queueAccepts(photoPersisted = true) {
  mockEnqueueException.mockReturnValue({ persisted: true, photoPersisted })
}

describe('LogExceptionPageClient submit receipt (5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueAccepts()
  })

  it('fires a success toast naming the chosen category, then navigates to the hub', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(logException).toHaveBeenCalledWith('cargo_damage', { description: '' })
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
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Vehicle breakdown'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(screen.getByText(/could not submit/i)).toBeInTheDocument())
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

// Audit fixes: the offline-queue success path previously navigated away with NO receipt
// (unlike CheckpointPageClient's identical path), and the terminal-4xx branch showed
// "check your connection" copy precisely where the code knows retrying won't help.

describe('LogExceptionPageClient failure feedback (audit fixes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueAccepts()
  })

  it('on a network failure, queues the exception, fires the saved-on-device toast, and advances to the hub', async () => {
    const logException = vi.fn().mockRejectedValue(new TypeError('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueException).toHaveBeenCalledWith(
      'trip-1',
      { exception_type: 'cargo_damage', description: '' },
      // No photo captured, so nothing extra travels with the entry.
      undefined,
    )
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Report saved',
        body: expect.stringContaining('sync'),
      }),
    )
  })

  it('shows honest not-accepted copy (not connection copy) on a terminal 4xx', async () => {
    const logException = vi.fn().mockRejectedValue(new ApiError(422, 'invalid'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() =>
      expect(screen.getByText(/the report was not accepted/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument()
    expect(mockEnqueueException).not.toHaveBeenCalled()
  })
})

describe('LogExceptionPageClient back link (5d)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueAccepts()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException: vi.fn() })
  })

  it('shows a "← In-Transit Hub" back target (SubpageHeader) that pushes the hub route (not router.back)', () => {
    render(<LogExceptionPageClient />)

    const backLink = screen.getByText('← In-Transit Hub')
    // min-h-[44px] is SubpageHeader's shared 44px minimum touch target for a
    // stressed/gloved hand — see components/layout/SubpageHeader.tsx.
    expect(backLink).toHaveClass('min-h-[44px]')

    fireEvent.click(backLink)

    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
    expect(mockRouterBack).not.toHaveBeenCalled()
  })
})

describe('LogExceptionPageClient phase tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueAccepts()
  })

  it('queues a breakdown against the leg being driven, resolved at report time', async () => {
    // Mechanical and seal-broken-in-transit are IN_TRANSIT events by definition. The
    // queued entry may not send until after arrival, so the tag is captured here — not
    // at flush time, when the trip has already moved on to unloading.
    const logException = vi.fn().mockRejectedValue(new Error('offline'))
    const phases = walk(SINGLE_LEG_PHASE_PLAN, 3)
    const inTransit = phases.find((p) => p.phase_type === 'in_transit')!
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1', phases }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Vehicle breakdown'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockEnqueueException).toHaveBeenCalled())
    expect(mockEnqueueException).toHaveBeenCalledWith(
      'trip-1',
      {
        exception_type: 'mechanical',
        description: '',
        phase_event_id: String(inTransit.phase_event_id),
      },
      undefined,
    )
  })

  it('still queues the report when the trip carries no phase plan', async () => {
    // Runs inside the catch block of an already-failed send — a throw here would lose
    // the report outright. Untagged beats unsent.
    const logException = vi.fn().mockRejectedValue(new Error('offline'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Seal broken in transit'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockEnqueueException).toHaveBeenCalled())
    expect(mockEnqueueException).toHaveBeenCalledWith(
      'trip-1',
      { exception_type: 'seal_broken_in_transit', description: '' },
      undefined,
    )
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
  })
})

// FP-150: the driver photographs the problem. The photo must reach the SAME evidence
// trail the phase steps already feed — POST /api/v1/artifacts, then the returned id on
// the exception as supporting_artifact_id — and must never disappear quietly when any
// step of that fails.

describe('LogExceptionPageClient photo capture (FP-150)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueAccepts()
    // Eager upload at capture does not land by default, so these tests exercise the
    // submit-time upload. The reuse case is asserted explicitly below.
    mockUploadNow.mockResolvedValue(null)
  })

  it('shows the captured photo back to the driver before they submit', async () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException: vi.fn() })

    render(<LogExceptionPageClient />)
    expect(screen.queryByAltText('captured photo')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Photo (optional)'))

    expect(await screen.findByAltText('captured photo')).toHaveAttribute('src', PHOTO_DATA_URL)
  })

  it('uploads the photo and attaches its artifact id to the report', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })
    mockUploadArtifact.mockResolvedValue({ id: 'artifact-1', file_hash: 'abc' })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Photo (optional)'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockUploadArtifact).toHaveBeenCalledWith({
      tripId: 'trip-1',
      artifactType: 'photo',
      dataUrl: PHOTO_DATA_URL,
      capturedAt: expect.any(String),
    })
    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: '',
      supporting_artifact_id: 'artifact-1',
    })
  })

  it('keeps the description working alongside the photo', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })
    mockUploadArtifact.mockResolvedValue({ id: 'artifact-1', file_hash: 'abc' })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.change(screen.getByPlaceholderText(/describe what happened/i), {
      target: { value: 'Pallet crushed on the left side' },
    })
    fireEvent.click(screen.getByText('Photo (optional)'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: 'Pallet crushed on the left side',
      supporting_artifact_id: 'artifact-1',
    })
  })

  it('reuses the id from the upload that started at capture instead of uploading twice', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })
    mockUploadNow.mockResolvedValue('artifact-eager')

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Photo (optional)'))
    // Let the eager upload resolve before submitting.
    await waitFor(() => expect(mockUploadNow).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('cargo_damage', {
      description: '',
      supporting_artifact_id: 'artifact-eager',
    })
    // The bytes are already on the server — uploading them again would duplicate the
    // artifact and spend a driver's data doing it.
    expect(mockUploadArtifact).not.toHaveBeenCalled()
  })

  it('queues the photo itself when the upload fails on a dead network', async () => {
    const logException = vi.fn()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })
    mockUploadArtifact.mockRejectedValue(new TypeError('network unreachable'))

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Photo (optional)'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockEnqueueException).toHaveBeenCalled())
    // The image travels WITH the queued entry — the whole point of FP-150's offline
    // decision. Without this the photo would be gone the moment the driver navigated.
    expect(mockEnqueueException).toHaveBeenCalledWith(
      'trip-1',
      { exception_type: 'cargo_damage', description: '' },
      { dataUrl: PHOTO_DATA_URL, capturedAt: expect.any(String) },
    )
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', body: expect.stringContaining('photo') }),
    )
    // The report was never sent, so it must not have been raised either.
    expect(logException).not.toHaveBeenCalled()
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
  })

  it('sends the report without the photo when the server terminally rejects the image', async () => {
    const logException = vi.fn().mockResolvedValue(undefined)
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })
    // 413 is what lib/api/artifacts.ts throws for an oversized photo — it will fail the
    // same way on every retry, so the written report must not be held hostage to it.
    mockUploadArtifact.mockRejectedValue(new ApiError(413, 'Photo is too large to upload'))

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Photo (optional)'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(logException).toHaveBeenCalled())
    expect(logException).toHaveBeenCalledWith('cargo_damage', { description: '' })
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Photo could not be attached' }),
    )
    // Queuing a photo the server has already refused would just reproduce the refusal.
    expect(mockEnqueueException).not.toHaveBeenCalled()
  })

  it('tells the driver when the photo could not be stored on the device', async () => {
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException: vi.fn() })
    mockUploadArtifact.mockRejectedValue(new TypeError('network unreachable'))
    // localStorage refused the entry with the image attached; the queue kept the text.
    queueAccepts(false)

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Photo (optional)'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockNotify).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        title: 'Report saved',
        body: expect.stringContaining('no room to store the photo'),
      }),
    )
  })

  it('says nothing was saved when the device cannot store the report at all', async () => {
    mockUseTrip.mockReturnValue({
      trip: { id: 'trip-1' },
      logException: vi.fn().mockRejectedValue(new TypeError('network unreachable')),
    })
    mockEnqueueException.mockReturnValue({ persisted: false, photoPersisted: false })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Submit exception'))

    // Nothing holds this report — not the server, not the device. A "Report saved"
    // receipt here would be a lie, and the driver would never re-report it.
    await waitFor(() => expect(screen.getByText(/out of storage/i)).toBeInTheDocument())
    expect(mockNotify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Report saved' }))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})
