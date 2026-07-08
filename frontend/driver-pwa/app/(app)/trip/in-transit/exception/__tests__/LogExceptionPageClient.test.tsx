import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LogExceptionPageClient from '../LogExceptionPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'

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
