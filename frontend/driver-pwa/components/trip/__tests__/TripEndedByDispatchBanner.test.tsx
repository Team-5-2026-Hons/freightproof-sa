import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TripContext } from '@/lib/context/TripContext'
import { TripEndedByDispatchBanner } from '../TripEndedByDispatchBanner'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }) }))

type Ctx = NonNullable<React.ContextType<typeof TripContext>>

function renderWith(endedByDispatch: Ctx['endedByDispatch'], dismissEndedByDispatch = vi.fn()) {
  const value = { endedByDispatch, dismissEndedByDispatch } as unknown as Ctx
  render(<TripContext.Provider value={value}><TripEndedByDispatchBanner /></TripContext.Provider>)
  return { dismissEndedByDispatch }
}

describe('TripEndedByDispatchBanner', () => {
  it('renders nothing when no trip was ended', () => {
    // Arrange / Act
    renderWith(null)

    // Assert
    expect(screen.queryByText('Dispatch has ended this trip')).not.toBeInTheDocument()
  })

  it('says the trip ended without naming any reason or incident', () => {
    // Arrange / Act
    renderWith({ tripId: 't1', tripReference: 'FP-0042', endedAt: '2026-10-20T11:42:00Z' })

    // Assert
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Dispatch has ended this trip')
    expect(banner).toHaveTextContent('FP-0042')
    // The phone may be in the hijacker's hands: no word of what was reported.
    expect(banner.textContent?.toLowerCase()).not.toMatch(/hijack|incident|theft|stolen|police|saps/)
  })

  it('opens the record and dismisses', () => {
    // Arrange
    const { dismissEndedByDispatch } = renderWith({ tripId: 't1', tripReference: 'FP-0042', endedAt: null })

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'View your record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    // Assert
    expect(push).toHaveBeenCalledOnce()
    expect(dismissEndedByDispatch).toHaveBeenCalledOnce()
  })
})
