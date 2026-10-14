import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VERDICT_WORDING, type PhaseOutcome, type PhaseVerdict } from '@/lib/phase/verdict'
import { PhaseVerdictLine } from '../PhaseVerdictLine'
import { line } from './textLine'

function verdict(outcome: PhaseOutcome, headline: string, reasons: string[] = [], reviewed = false): PhaseVerdict {
  return { outcome, headline, reasons, nodeType: outcome === 'attention' ? 'warn' : 'done', ...(reviewed ? { reviewed } : {}) }
}

function iconOf(): string | null {
  return document.querySelector('[data-verdict-icon]')?.getAttribute('data-verdict-icon') ?? null
}

describe('PhaseVerdictLine', () => {
  it('says the outcome in an icon, a word and its reasons, never colour alone', () => {
    render(<PhaseVerdictLine verdict={verdict('attention', 'Needs attention', ['1 exception to review', 'Seal found damaged'])} />)

    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText(line(/1 exception to review · Seal found damaged/))).toBeInTheDocument()
    expect(iconOf()).toBe('warn')
  })

  it.each([
    ['attention', 'Needs attention', 'warn'],
    ['unverified', 'Not fully verified', 'eye'],
    ['clean', 'Checks passed', 'check'],
    ['overridden', 'Closed by dispatcher override', 'shield'],
    ['in_progress', 'In progress', 'clock'],
    ['current', 'Current phase', 'clock'],
  ] as const)('shows the %s outcome "%s" with the %s icon', (outcome, headline, icon) => {
    render(<PhaseVerdictLine verdict={verdict(outcome, headline, ['reason'])} />)

    expect(iconOf()).toBe(icon)
  })

  it('gives a reviewed outcome the tick from the verdict\'s own flag, whatever its words are', () => {
    render(<PhaseVerdictLine verdict={verdict('reviewed', 'Anything at all', ['reason'], true)} />)

    expect(iconOf()).toBe('check')
  })

  it('does not give a merely recorded exception the reviewed tick', () => {
    render(<PhaseVerdictLine verdict={verdict('reviewed', VERDICT_WORDING.reviewed.recordedOne, ['Cargo Damage (info)'])} />)

    expect(iconOf()).toBe('eye')
    expect(screen.getByText('Exception recorded')).toBeInTheDocument()
  })

  it('never uses "Clean" as a verdict word', () => {
    render(<PhaseVerdictLine verdict={verdict('clean', VERDICT_WORDING.clean.headline, [VERDICT_WORDING.clean.noExceptions])} />)

    expect(screen.queryByText(/^clean$/i)).not.toBeInTheDocument()
    expect(screen.getByText('Checks passed')).toBeInTheDocument()
  })

  it('applies the numeric rule to the values in its reasons', () => {
    render(<PhaseVerdictLine verdict={verdict('in_progress', 'In progress', ['7 of 7 parcels scanned', '3 h 12 m on the road'])} />)

    expect(screen.getAllByText('7')[0]).toHaveClass('tabular-nums', 'font-semibold')
    expect(screen.getByText('12')).toHaveClass('tabular-nums')
  })

  it('omits the separator when a verdict has no reasons', () => {
    const { container } = render(<PhaseVerdictLine verdict={verdict('current', 'Current phase')} />)

    expect(container.textContent).toBe('Current phase')
  })
})
