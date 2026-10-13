import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NUMERIC_VALUE, NumericText } from '../NumericText'

const NUMERIC_CLASSES = ['font-semibold', 'tabular-nums']

describe('NumericText (DESIGN_SYSTEM §5.2)', () => {
  it('puts the numeric rule on a seal number, a count and an id, and on nothing else in the line', () => {
    const { container } = render(<p><NumericText text="Seal FP-7204 · 7 parcels · Authorised by user-42" /></p>)

    for (const value of ['FP-7204', '7', 'user-42']) {
      expect(screen.getByText(value)).toHaveClass(...NUMERIC_CLASSES, 'tracking-[0.03em]')
    }
    expect(container.querySelectorAll('span.tabular-nums')).toHaveLength(3)
    expect(container.textContent).toBe('Seal FP-7204 · 7 parcels · Authorised by user-42')
  })

  it('treats a duration as values around plain unit words', () => {
    render(<p><NumericText text="3 h 12 m on the road" /></p>)

    expect(screen.getByText('3')).toHaveClass('tabular-nums')
    expect(screen.getByText('12')).toHaveClass('tabular-nums')
    expect(document.querySelectorAll('span')).toHaveLength(2)
  })

  it('leaves a line with no value as plain text', () => {
    const { container } = render(<p><NumericText text="Needs attention" /></p>)

    expect(container.querySelector('span')).toBeNull()
  })

  it('exports the one class string', () => {
    expect(NUMERIC_VALUE).toBe('font-semibold tabular-nums tracking-[0.03em]')
  })
})
