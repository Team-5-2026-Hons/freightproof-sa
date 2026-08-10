import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StepHeader } from '../StepHeader'
import { ROUTES } from '@/lib/constants/routes'
import { phaseStepRoute } from '@/lib/phase'
import { makePhase } from './testFixtures'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), replace: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StepHeader', () => {
  it('renders an emergency panic button', () => {
    render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

    expect(
      screen.getByRole('button', { name: 'Emergency — open panic alert' }),
    ).toBeInTheDocument()
  })

  it('navigates to the panic page when the emergency button is pressed', () => {
    render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Emergency — open panic alert' }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.panic)
  })

  it('renders the phase name and the current step name, with a current/total counter', () => {
    // departure's recipe: ['Capture Seal', 'Confirm Departure'] — stepIndex 1 is the
    // last of two. 'Photograph Linehaul Document' is gone from it (2026-08-10): it
    // captured the sheet loading's '1-linehaul' step already photographs. (activation is
    // down to a single step since its GPS-capture step was removed, so it can no longer
    // show a 2-of-N counter.)
    render(<StepHeader phase={makePhase('departure')} stepIndex={1} />)

    expect(screen.getByText('Departure')).toBeInTheDocument()
    expect(screen.getByText('Confirm Departure')).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  describe('back navigation — first step of a phase (stepIndex === 0)', () => {
    it('labels the back button "Back to trip"', () => {
      render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

      expect(screen.getByRole('button', { name: 'Back to trip' })).toBeInTheDocument()
    })

    it('exits the phase entirely, back to the active trip detail', () => {
      render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back to trip' }))

      expect(mockPush).toHaveBeenCalledWith(ROUTES.activeTripDetail)
    })
  })

  describe('back navigation — mid-phase (stepIndex > 0)', () => {
    it('labels the back button "Back to previous step"', () => {
      render(<StepHeader phase={makePhase('departure')} stepIndex={1} />)

      expect(screen.getByRole('button', { name: 'Back to previous step' })).toBeInTheDocument()
    })

    it('goes to the previous step of the SAME phase type, not out of it', () => {
      // departure's slugs: ['2-capture-seal', '4-departure']
      render(<StepHeader phase={makePhase('departure')} stepIndex={1} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(phaseStepRoute('departure', '2-capture-seal'))
      expect(mockPush).not.toHaveBeenCalledWith(ROUTES.activeTripDetail)
    })

    it('works from a later step too (confirmation, step 3 back to step 2)', () => {
      // confirmation, not departure: departure is down to two steps since '3-waybill'
      // was removed, so it no longer HAS a stepIndex 2 to walk back from. confirmation's
      // slugs: ['1-pod-photo', '2-pod-signature', '3-reconciliation', '4-closed'].
      render(<StepHeader phase={makePhase('confirmation')} stepIndex={2} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(phaseStepRoute('confirmation', '2-pod-signature'))
    })
  })
})
