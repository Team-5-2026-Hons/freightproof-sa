// frontend/driver-pwa/app/(app)/trip/panic/submitted/__tests__/PanicSubmittedPageClient.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PanicSubmittedPageClient from '../PanicSubmittedPageClient'
import { ROUTES } from '@/lib/constants/routes'

const mockReplace = vi.fn()
// Reassigned per-test so a plain call vs. a `?queued=1` call can be told apart —
// mirrors the pattern app/otp/__tests__/page.test.tsx uses for useSearchParams.
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}))

describe('PanicSubmittedPageClient (Fix 2: honest sent-vs-queued copy)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claims the dispatcher was notified when the alert actually sent (no queued param)', () => {
    mockSearchParams = new URLSearchParams()

    render(<PanicSubmittedPageClient />)

    expect(screen.getByText('Alert sent')).toBeInTheDocument()
    expect(screen.getByText(/your dispatcher has been notified/i)).toBeInTheDocument()
    expect(screen.queryByText(/stored on this device/i)).not.toBeInTheDocument()
  })

  it('shows honest queued copy — never claims the dispatcher was notified — when queued=1', () => {
    mockSearchParams = new URLSearchParams('queued=1')

    render(<PanicSubmittedPageClient />)

    expect(screen.getByText('Alert saved')).toBeInTheDocument()
    expect(screen.getByText(/stored on this device/i)).toBeInTheDocument()
    expect(screen.getByText(/no signal right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/your dispatcher has been notified/i)).not.toBeInTheDocument()
  })

  it('still lets the driver return to in-transit from the queued state', () => {
    mockSearchParams = new URLSearchParams('queued=1')

    render(<PanicSubmittedPageClient />)
    fireEvent.click(screen.getByText('Return to in-transit'))

    expect(mockReplace).toHaveBeenCalledWith(ROUTES.inTransit)
  })
})
