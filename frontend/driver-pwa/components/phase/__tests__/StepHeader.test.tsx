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
    // activation's recipe: ['Gate Arrival', 'Verification'] — stepIndex 1 is 'Verification'.
    render(<StepHeader phase={makePhase('activation')} stepIndex={1} />)

    expect(screen.getByText('Activation')).toBeInTheDocument()
    expect(screen.getByText('Verification')).toBeInTheDocument()
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
      render(<StepHeader phase={makePhase('activation')} stepIndex={1} />)

      expect(screen.getByRole('button', { name: 'Back to previous step' })).toBeInTheDocument()
    })

    it('goes to the previous step of the SAME phase type, not out of it', () => {
      render(<StepHeader phase={makePhase('activation')} stepIndex={1} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(phaseStepRoute('activation', '1-approach-gate'))
      expect(mockPush).not.toHaveBeenCalledWith(ROUTES.activeTripDetail)
    })

    it('works for a phase type with more steps too (departure, step 3 back to step 2)', () => {
      // departure's slugs: ['1-approach-exit', '2-capture-seal', '3-waybill', '4-departure']
      render(<StepHeader phase={makePhase('departure')} stepIndex={2} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(phaseStepRoute('departure', '2-capture-seal'))
    })
  })
})
