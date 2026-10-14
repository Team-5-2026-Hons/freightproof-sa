// Ports the PhaseProgressBar and CurrentPhaseCard checks to the overhaul's phase list.
// Counts exclude trip_creation (a system phase the driver never performs), matching the
// "Phase n of N" everywhere else: single-leg = 7 rows, cross-dock = 12.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PhaseList } from '../PhaseList'
import { currentPhase } from '@/lib/phase'
import { SINGLE_LEG_PHASE_PLAN, CROSS_DOCK_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

function rows(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Trip phases' })).getAllByRole('listitem')
}

describe('PhaseList', () => {
  it('test_one_row_per_driver_phase_on_a_single_leg_plan', () => {
    render(<PhaseList phases={SINGLE_LEG_PHASE_PLAN} />)

    expect(rows()).toHaveLength(SINGLE_LEG_PHASE_PLAN.filter((p) => p.phase_type !== 'trip_creation').length)
  })

  it('test_one_row_per_driver_phase_on_a_cross_dock_plan_with_repeats_kept', () => {
    render(<PhaseList phases={CROSS_DOCK_PHASE_PLAN} />)

    const expected = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type !== 'trip_creation').length
    expect(rows()).toHaveLength(expected)
    expect(screen.getAllByText('Unloading').length).toBeGreaterThan(1)
  })

  it('test_renders_in_plan_order_whatever_order_they_arrive_in', () => {
    render(<PhaseList phases={[...SINGLE_LEG_PHASE_PLAN].reverse()} />)

    expect(rows()[0]).toHaveTextContent('Activation')
  })

  it('test_marks_exactly_one_row_as_the_current_step', () => {
    const { container } = render(<PhaseList phases={walk(SINGLE_LEG_PHASE_PLAN, 2)} />)

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
  })

  it('test_completed_phases_say_done_not_just_a_tick', () => {
    render(<PhaseList phases={walk(SINGLE_LEG_PHASE_PLAN, 2)} />)

    expect(rows()[0]).toHaveTextContent('Done')
  })

  it('test_an_exception_phase_is_flagged', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map((p, i) => (i === 2 ? { ...p, status: 'exception' as const } : p))

    render(<PhaseList phases={plan} />)

    expect(screen.getByText(/Issue recorded/)).toBeInTheDocument()
  })

  it('test_only_the_current_phase_is_tappable', () => {
    const onSelect = vi.fn()
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 1)
    render(<PhaseList phases={plan} onSelectCurrent={onSelect} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    expect(buttons).toHaveLength(1)
    expect(onSelect).toHaveBeenCalledWith(currentPhase(plan))
  })

  it('test_shows_the_stop_label_to_tell_repeated_phases_apart', () => {
    render(<PhaseList phases={CROSS_DOCK_PHASE_PLAN} />)

    expect(screen.getAllByText(/Stop \d|Origin|Destination/).length).toBeGreaterThan(0)
  })

  it('test_anchor_state_is_honest_about_a_failed_anchor', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2).map((p, i) =>
      i === 1 ? { ...p, anchor_status: 'failed' as const } : i === 2 ? { ...p, anchor_status: 'anchored' as const } : p)

    render(<PhaseList phases={plan} />)

    expect(screen.getByText('Receipt owed')).toBeInTheDocument()
    expect(screen.getByLabelText('Anchored on Hedera')).toBeInTheDocument()
  })

  it('test_record_mode_shows_when_each_phase_completed', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 2).map((p) => (p.status === 'completed' ? { ...p, completed_at: '2026-05-03T09:00:00Z' } : p))

    render(<PhaseList phases={plan} showTimes />)

    expect(rows()[0]).toHaveTextContent(/\d{2}:\d{2}/)
  })
})
