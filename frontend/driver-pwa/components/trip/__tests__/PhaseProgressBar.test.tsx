// frontend/driver-pwa/components/trip/__tests__/PhaseProgressBar.test.tsx
//
// Replaces HandshakeProgressBar.test.tsx. The old bar assumed exactly 5 equal-width
// cells; this one renders one timeline row PER phase down the page, so its row count
// must track the plan's own length — proven here against both canonical fixtures
// (7-row single-leg, 11-row cross-dock) rather than just one, so a regression back to
// a fixed count fails on whichever fixture no longer fits.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PhaseProgressBar } from '../PhaseProgressBar'
import { SINGLE_LEG_PHASE_PLAN, CROSS_DOCK_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

// The bar renders a real <ol>/<li>, so rows are counted through the listitem role
// rather than a layout class (the old hook was CELL_WIDTH_CLASS, 'w-16', which died
// with the horizontal layout). Counting by role also survives restyling, and phase-name
// text can't be used instead: it repeats on a cross-dock plan (e.g. two "Unloading" rows).
function rowCount(): number {
  return screen.getAllByRole('listitem').length
}

describe('PhaseProgressBar', () => {
  it('renders exactly 7 rows for the single-leg plan', () => {
    expect(SINGLE_LEG_PHASE_PLAN).toHaveLength(7)
    render(<PhaseProgressBar phases={SINGLE_LEG_PHASE_PLAN} />)

    expect(rowCount()).toBe(7)
  })

  it('renders exactly 11 rows for the cross-dock plan', () => {
    expect(CROSS_DOCK_PHASE_PLAN).toHaveLength(11)
    render(<PhaseProgressBar phases={CROSS_DOCK_PHASE_PLAN} />)

    expect(rowCount()).toBe(11)
  })

  it('renders a repeated phase type more than once rather than collapsing it', () => {
    render(<PhaseProgressBar phases={CROSS_DOCK_PHASE_PLAN} />)

    const expectedCount = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'unloading').length
    expect(expectedCount).toBeGreaterThan(1)
    expect(screen.getAllByText('Unloading')).toHaveLength(expectedCount)
  })

  it('marks a completed phase with a checkmark instead of its plain sequence number', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0) // resolves trip_creation (sequence 0)

    const { container } = render(<PhaseProgressBar phases={plan} />)

    // trip_creation's own sequence number (0) must not appear as a bare digit inside
    // a completed dot — it should have swapped to the check icon instead.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(container.querySelector('svg.lucide-check')).not.toBeNull()
  })

  it('marks exactly one row as the current step for assistive tech', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0) // resolves trip_creation; activation is next

    render(<PhaseProgressBar phases={plan} />)

    // The vertical list has no scroll-into-view affordance to lean on any more, so
    // aria-current is the only thing telling a screen-reader user where the driver is.
    const marked = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-current') === 'step')
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveTextContent('Activation')
  })

  it('renders rows in plan order regardless of the order they arrive in', () => {
    const shuffled = [...SINGLE_LEG_PHASE_PLAN].reverse()

    render(<PhaseProgressBar phases={shuffled} />)

    const rendered = screen.getAllByRole('listitem').map((li) => li.textContent)
    const expected = [...SINGLE_LEG_PHASE_PLAN]
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .map((p) => PHASE_NAMES[p.phase_type])
    // Top-to-bottom reading order IS the sequence now — a mis-sorted vertical list is
    // silently wrong in a way the old horizontal scroller at least made obvious.
    rendered.forEach((text, i) => expect(text).toContain(expected[i]))
  })

  it('marks an exception phase with a warning icon', () => {
    const plan = SINGLE_LEG_PHASE_PLAN.map((p) =>
      p.sequence_number === 0 ? { ...p, status: 'exception' as const } : p,
    )

    const { container } = render(<PhaseProgressBar phases={plan} />)

    expect(container.querySelector('svg.lucide-triangle-alert')).not.toBeNull()
  })
})
