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

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterBack = vi.fn()
const mockNotify = vi.fn()
const mockEnqueueException = vi.fn()

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

// Button is being reworked in a parallel task — stub it so this suite only
// exercises the page's own behavior, not Button internals.
vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

describe('LogExceptionPageClient submit receipt (5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('on a network failure, queues the exception, fires the saved-on-device toast, and advances to the hub', async () => {
    const logException = vi.fn().mockRejectedValue(new TypeError('network unreachable'))
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' }, logException })

    render(<LogExceptionPageClient />)
    fireEvent.click(screen.getByText('Cargo damage'))
    fireEvent.click(screen.getByText('Submit exception'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueException).toHaveBeenCalledWith('trip-1', {
      exception_type: 'cargo_damage',
      description: '',
    })
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
    expect(mockEnqueueException).toHaveBeenCalledWith('trip-1', {
      exception_type: 'mechanical',
      description: '',
      phase_event_id: String(inTransit.phase_event_id),
    })
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
    expect(mockEnqueueException).toHaveBeenCalledWith('trip-1', {
      exception_type: 'seal_broken_in_transit',
      description: '',
    })
    expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit)
  })
})
