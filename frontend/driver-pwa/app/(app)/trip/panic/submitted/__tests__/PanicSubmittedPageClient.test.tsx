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
    fireEvent.click(screen.getByText('Back to In Transit'))

    expect(mockReplace).toHaveBeenCalledWith(ROUTES.inTransit)
  })
})

describe('PanicSubmittedPageClient — this alert’s own facts (overhaul 7.2/7.3)', () => {
  const at = new Date(2026, 9, 14, 14, 32, 7).toISOString()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('test_states_when_it_sent_and_that_the_location_went_with_it', () => {
    mockSearchParams = new URLSearchParams({ at, loc: '1' })

    render(<PanicSubmittedPageClient />)

    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(screen.getByText('14:32:07')).toBeInTheDocument()
    expect(screen.getByText('Attached')).toBeInTheDocument()
    expect(screen.getByText('Timestamped')).toBeInTheDocument()
  })

  it('test_says_plainly_when_no_location_went', () => {
    mockSearchParams = new URLSearchParams({ at, loc: '0' })

    render(<PanicSubmittedPageClient />)

    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.queryByText('Attached')).toBeNull()
  })

  it('test_a_saved_alert_says_when_it_was_recorded_and_that_it_waits_for_signal', () => {
    mockSearchParams = new URLSearchParams({ queued: '1', at, loc: '1' })

    render(<PanicSubmittedPageClient />)

    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('14:32:07')).toBeInTheDocument()
    expect(screen.getByText('Waiting for signal')).toBeInTheDocument()
    expect(screen.queryByText('Timestamped')).toBeNull()
  })

  it('test_leaves_out_the_time_row_rather_than_invent_one', () => {
    mockSearchParams = new URLSearchParams()

    render(<PanicSubmittedPageClient />)

    expect(screen.queryByText('Sent')).toBeNull()
  })
})
