import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TripException } from '@shared/lib/types/exception'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { EXCEPTION_SELECTION_OUTLINE, ExceptionMoreRow, ExceptionRow, exceptionRowId } from '../ExceptionRow'
import { ExceptionRowList } from '../ExceptionRowList'
import { COMPACT_HIT_AREA } from '../CompactActLine'

function exception(id: string, overrides: Partial<TripException> = {}): TripException {
  return {
    id: id as TripException['id'], trip_id: 'trip-1', exception_type: 'trailer_separated_in_transit', source: 'system',
    severity: 'critical', description: 'Trailer tracker reads 840 m from the horse tracker.', phase_event_id: 'phase-1',
    checkpoint_id: null, supporting_artifact_id: null, review_status: 'needs_review', review_outcome: null,
    reviewed_by_user_id: null, reviewed_at: null, review_note: null, contact_method: null, vehicle_id: null,
    merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
    created_at: '2026-01-01T08:42:00Z', updated_at: '2026-01-01T08:42:00Z', ...overrides,
  }
}

const AT = '2026-01-01T08:42:00Z'

describe('ExceptionRow', () => {
  it.each(['compact', 'full'] as const)('outlines the brief landing highlight too (%s)', density => {
    render(<ExceptionRow exception={exception('landing')} at={AT} phaseId="p" selected={false} highlighted onOpen={vi.fn()} density={density} />)

    expect(screen.getByRole('button')).toHaveClass(EXCEPTION_SELECTION_OUTLINE, 'bg-sec-c/70')
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current')
  })
  it('keeps the soft selected surface with a complete outline and separate keyboard focus', () => {
    render(<ExceptionRow exception={exception('selected')} at={AT} phaseId="p" selected highlighted={false} onOpen={vi.fn()} />)

    const row = screen.getByRole('button')
    expect(row).toHaveClass('bg-sec-c/25')
    expect(row).toHaveClass(EXCEPTION_SELECTION_OUTLINE)
    expect(row.className).not.toContain('before:')
    expect(row).toHaveClass('focus-visible:outline-2')
    expect(row).toHaveTextContent('Critical')
    expect(row).toHaveAttribute('aria-current', 'true')
  })
  it.each(['compact', 'full'] as const)('marks selection with an inner hairline, leaving the outer outline to keyboard focus (%s)', density => {
    render(<ExceptionRow exception={exception('selected')} at={AT} phaseId="p" selected highlighted={false} onOpen={vi.fn()} density={density} />)

    const row = screen.getByRole('button')
    expect(EXCEPTION_SELECTION_OUTLINE).toContain('inset_0_0_0_1px')
    expect(row).toHaveClass(EXCEPTION_SELECTION_OUTLINE, 'bg-sec-c/25', 'focus-visible:outline-2')
    expect(row.className).not.toMatch(/(^| )ring-/)
  })
  it('keeps a compact row one line tall to the eye with a 44 px target, and draws its connector from the icon', () => {
    const { rerender } = render(<ExceptionRow exception={exception('compact')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} density="compact" />)

    const row = screen.getByRole('button')
    expect(row).not.toHaveClass('min-h-11')
    expect(row).toHaveClass(...COMPACT_HIT_AREA.split(' '), 'relative')
    expect(row.querySelector('[data-compact-connector]')).toBeNull()

    rerender(<ExceptionRow exception={exception('compact')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} density="compact" connectToNext />)
    expect(row.querySelector('[data-compact-icon] > [data-compact-connector]')).not.toBeNull()
  })
  it('gives the compact "+n more" row the same height and target as an exception row', () => {
    render(<ExceptionMoreRow hiddenCount={3} phaseId="p" onOpen={vi.fn()} density="compact" />)

    const row = screen.getByRole('button')
    expect(row).not.toHaveClass('min-h-11')
    expect(row).toHaveClass(...COMPACT_HIT_AREA.split(' '))
  })
  it('gives compact exceptions visible hover feedback without shifting their columns', () => {
    render(<ExceptionRow exception={exception('hover')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} density="compact" />)

    const row = screen.getByRole('button')
    expect(row).toHaveClass('hover:bg-sec-c/40', 'hover:duration-150')
    expect(row.querySelector('[data-compact-act]')).not.toBeNull()
  })

  it('clamps the description without a competing display:block', () => {
    render(<ExceptionRow exception={exception('e')} at={AT} phaseId={null} selected={false} highlighted={false} onOpen={vi.fn()} />)
    const description = screen.getByText('Trailer tracker reads 840 m from the horse tracker.')

    expect(description).toHaveClass('line-clamp-2')
    expect(description).not.toHaveClass('block')
  })
  it('shows type, severity, time, source, review state and the description', () => {
    render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="phase-1" selected={false} highlighted={false} onOpen={vi.fn()} />)

    const row = screen.getByRole('button', { name: /Trailer separated on the road/ })
    expect(row).toHaveTextContent('Trailer separated on the road')
    expect(row).toHaveTextContent('Critical')
    expect(row).toHaveTextContent(fmtDateTime(AT))
    expect(row).toHaveTextContent('Raised by system')
    expect(row).toHaveTextContent('Needs review')
    expect(row).toHaveTextContent('Trailer tracker reads 840 m from the horse tracker.')
  })

  it('is one button whose accessible name carries the type, severity, review state and the action', () => {
    render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="phase-1" selected={false} highlighted={false} onOpen={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Trailer separated on the road, Critical, Needs review. Open in exceptions panel. Trailer tracker reads 840 m from the horse…',
    )
  })

  it('carries the first words of the visible description in its accessible name, so the name contains what is shown', () => {
    const description = 'Horse left the planned corridor by 1.2 km for 9 minutes near the depot gate.'
    render(<ExceptionRow exception={exception('e1', { description })} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)

    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Horse left the planned corridor by 1.2 km')
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toContain('for 9')
  })

  it('does not truncate a short description', () => {
    render(<ExceptionRow exception={exception('e1', { description: 'Tracker silent.' })} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)

    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/Tracker silent\.$/)
  })

  it('opens the exception, with its phase, on a click', async () => {
    const onOpen = vi.fn()
    render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="phase-1" selected={false} highlighted={false} onOpen={onOpen} />)

    await userEvent.click(screen.getByRole('button'))

    expect(onOpen).toHaveBeenCalledWith('e1', 'phase-1')
  })

  it.each([['{Enter}'], [' ']])('opens the exception from the keyboard (%j)', async key => {
    const onOpen = vi.fn()
    render(<ExceptionRow exception={exception('e1')} at={AT} phaseId={null} selected={false} highlighted={false} onOpen={onOpen} />)

    screen.getByRole('button').focus()
    await userEvent.keyboard(key)

    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith('e1', null)
  })

  it('labels the clock: the phone\'s when the time is the evidence capture, the server\'s otherwise', () => {
    const { rerender } = render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('(system recorded)')

    rerender(<ExceptionRow exception={exception('e1')} at="2026-01-01T08:30:00Z" phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('(driver’s phone)')
  })

  it('marks the selected row for assistive tech and the highlighted row for the eye', () => {
    const { rerender } = render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button')).not.toHaveAttribute('data-highlighted')

    rerender(<ExceptionRow exception={exception('e1')} at={AT} phaseId="p" selected highlighted onOpen={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button')).toHaveAttribute('data-highlighted', 'true')
  })

  it('has an anchor id so "Show in timeline" can scroll to it', () => {
    render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveAttribute('id', exceptionRowId('e1'))
  })

  it('never renders the full exception card', () => {
    const { container } = render(<ExceptionRow exception={exception('e1')} at={AT} phaseId="p" selected={false} highlighted={false} onOpen={vi.fn()} />)

    expect(container.querySelector('article')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('ExceptionMoreRow', () => {
  it('opens the panel on the phase\'s records with no single exception selected', async () => {
    const onOpen = vi.fn()
    render(<ExceptionMoreRow hiddenCount={3} phaseId="phase-1" onOpen={onOpen} />)

    await userEvent.click(screen.getByRole('button', { name: /\+3 more/ }))

    expect(onOpen).toHaveBeenCalledWith(null, 'phase-1')
    expect(screen.getByRole('button')).toHaveTextContent('+3 more · Open in exceptions panel')
  })
})

describe('ExceptionRowList', () => {
  it('lists its rows and the "+n more" row once, for a collapsed card', () => {
    const rows = [exception('a'), exception('b')].map(e => ({ exception: e, at: AT }))
    render(<ExceptionRowList rows={rows} hiddenCount={2} phaseId="phase-1" selectedId={null} highlightedId={null} onOpen={vi.fn()} />)

    expect(screen.getAllByRole('button', { name: /Trailer separated on the road/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /more/ })).toHaveLength(1)
  })

  it('shows no "+n more" row when nothing is hidden', () => {
    render(<ExceptionRowList rows={[{ exception: exception('a'), at: AT }]} hiddenCount={0} phaseId="phase-1" selectedId={null} highlightedId={null} onOpen={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
  })
})
