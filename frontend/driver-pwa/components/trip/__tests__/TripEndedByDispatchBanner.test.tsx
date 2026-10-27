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
    renderWith(null)

    expect(screen.queryByText('Dispatch has ended this trip')).not.toBeInTheDocument()
  })

  it('says the trip ended without naming any reason or incident', () => {
    renderWith({ tripId: 't1', tripReference: 'FP-0042', endedAt: '2026-10-20T11:42:00Z' })

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Dispatch has ended this trip')
    expect(banner).toHaveTextContent('FP-0042')
    expect(banner.textContent?.toLowerCase()).not.toMatch(/hijack|incident|theft|stolen|police|saps/)
  })

  it('opens the record and dismisses', () => {
    const { dismissEndedByDispatch } = renderWith({ tripId: 't1', tripReference: 'FP-0042', endedAt: null })

    fireEvent.click(screen.getByRole('button', { name: 'View your record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(push).toHaveBeenCalledOnce()
    expect(dismissEndedByDispatch).toHaveBeenCalledOnce()
  })
})
