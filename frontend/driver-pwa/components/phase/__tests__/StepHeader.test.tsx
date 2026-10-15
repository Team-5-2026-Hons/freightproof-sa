import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StepHeader } from '../StepHeader'
import { ROUTES } from '@/lib/constants/routes'
import { phaseStepRoute } from '@/lib/phase'
import { makePhase } from './testFixtures'
import { recordScreen, resetBackStack } from '@/lib/navigation/back-stack'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// The header reads the session trip for its trip-wide progress (overhaul 4.x).
let mockTripPhases: PhaseDescriptor[] | null = null
vi.mock('@/lib/hooks/useOptionalTrip', () => ({
  useOptionalTrip: () => (mockTripPhases === null ? null : { trip: { phases: mockTripPhases } }),
}))

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), replace: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockTripPhases = null
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

  it('test_names_the_phase_with_its_place_in_the_trip_and_the_step_count', () => {
    // departure is phase 3 of 7 driver phases; its recipe has two steps.
    const departureIndex = SINGLE_LEG_PHASE_PLAN.findIndex((p) => p.phase_type === 'departure')
    const plan = walk(SINGLE_LEG_PHASE_PLAN, SINGLE_LEG_PHASE_PLAN[departureIndex].sequence_number - 1)
    mockTripPhases = plan

    render(<StepHeader phase={plan[departureIndex]} stepIndex={1} />)

    expect(screen.getByRole('heading', { name: 'Departure' })).toBeInTheDocument()
    expect(screen.getByText('Phase 3 of 7 · Step 2 of 2')).toBeInTheDocument()
  })

  it('test_omits_the_step_count_for_a_one_step_phase', () => {
    render(<StepHeader phase={makePhase('arrival')} stepIndex={0} />)

    expect(screen.queryByText(/Step 1 of 1/)).toBeNull()
  })

  it('test_draws_the_trip_progress_done_ink_current_blue', () => {
    const departureIndex = SINGLE_LEG_PHASE_PLAN.findIndex((p) => p.phase_type === 'departure')
    const plan = walk(SINGLE_LEG_PHASE_PLAN, SINGLE_LEG_PHASE_PLAN[departureIndex].sequence_number - 1)
    mockTripPhases = plan

    const { container } = render(<StepHeader phase={plan[departureIndex]} stepIndex={0} />)

    const segments = container.querySelectorAll('[data-trip-progress] > span')
    expect(segments).toHaveLength(7)
    expect(segments[0]).toHaveClass('bg-surface-on')
    expect(segments[2]).toHaveClass('bg-secondary')
    expect(segments[3]).toHaveClass('bg-surface-container-high')
  })

  it('test_renders_without_trip_context_just_without_the_trip_bar', () => {
    const { container } = render(<StepHeader phase={makePhase('departure')} stepIndex={0} />)

    expect(container.querySelector('[data-trip-progress]')).toBeNull()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
  })

  describe('back navigation — first step of a phase (stepIndex === 0)', () => {
    it('labels the back button plainly "Back" — where it goes depends on the origin', () => {
      render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    it('exits to the active trip detail when the phase was opened cold', () => {
      resetBackStack()
      render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(mockPush).toHaveBeenCalledWith(ROUTES.activeTripDetail)
    })

    it('exits to the screen the phase was started from (Home)', () => {
      // Arrange — Home, then the first step of the phase.
      resetBackStack()
      recordScreen('/', '/', 'none')
      recordScreen('/trip/phase/activation/step/2-verification', '/trip/phase/activation/step/2-verification', 'forward')
      render(<StepHeader phase={makePhase('activation')} stepIndex={0} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/')
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
      // slugs: ['1-pod-photo', '2-receiver-handover', '3-reconciliation', '4-closed'].
      render(<StepHeader phase={makePhase('confirmation')} stepIndex={2} />)

      fireEvent.click(screen.getByRole('button', { name: 'Back to previous step' }))

      expect(mockPush).toHaveBeenCalledWith(phaseStepRoute('confirmation', '2-receiver-handover'))
    })
  })
})
