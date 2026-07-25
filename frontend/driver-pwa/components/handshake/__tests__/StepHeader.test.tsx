import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StepHeader } from '../StepHeader'
import { ROUTES } from '@/lib/constants/routes'
import type { HandshakeNumber } from '@shared/lib/types/handshake'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), replace: vi.fn() }),
}))

function renderHeader(handshake: HandshakeNumber, step: number) {
  render(<StepHeader handshake={handshake} step={step} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StepHeader', () => {
  it('renders an emergency panic button', () => {
    renderHeader(1, 1)

    expect(
      screen.getByRole('button', { name: 'Emergency — open panic alert' }),
    ).toBeInTheDocument()
  })

  it('navigates to the panic page when the emergency button is pressed', () => {
    renderHeader(1, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Emergency — open panic alert' }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.panic)
  })

  describe('back navigation — first step of a handshake (step === 1)', () => {
    it('labels the back button "Back to trip"', () => {
      renderHeader(1, 1)

      expect(screen.getByRole('button', { name: 'Back to trip' })).toBeInTheDocument()
    })

    it('exits the handshake entirely, back to the active trip detail', () => {
      renderHeader(1, 1)

      fireEvent.click(screen.getByRole('button', { name: 'Back to trip' }))

      expect(mockPush).toHaveBeenCalledWith(ROUTES.activeTripDetail)
    })
  })

  describe('back navigation — mid-handshake (step > 1)', () => {
    it('labels the back button "Back to previous step"', () => {
      // H1's steps: ['1-approach-gate', '2-verification'] — step 2
      // is '2-verification', so back should land on step 1's slug, '1-approach-gate'.
      renderHeader(1, 2)

      expect(screen.getByRole('button', { name: 'Back to previous step' })).toBeInTheDocument()
    })

    it('goes to the previous step of the SAME handshake, not out of it', () => {
      renderHeader(1, 2)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(ROUTES.handshakeStep(1, '1-approach-gate'))
      expect(mockPush).not.toHaveBeenCalledWith(ROUTES.activeTripDetail)
    })

    it('works for a later handshake too (H3, step 3 back to step 2)', () => {
      renderHeader(3, 3)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(ROUTES.handshakeStep(3, '2-exit-and-seal'))
    })
  })
})
