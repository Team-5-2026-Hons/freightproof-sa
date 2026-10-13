import { describe, expect, it } from 'vitest'
import type { PhaseCheck } from './checks'
import { chooseBodyLayout, realCheckCount, SPLIT_MIN_PX } from './layout'

describe('chooseBodyLayout (D30)', () => {
  it('splits only from 740 px of card, with at least one check, off in_transit', () => {
    expect(SPLIT_MIN_PX).toBe(740)
    expect(chooseBodyLayout({ widthPx: 772, checkCount: 2, phaseType: 'loading' })).toBe('split')
    expect(chooseBodyLayout({ widthPx: 740, checkCount: 1, phaseType: 'departure' })).toBe('split')
  })

  it('stacks below 740 px: a 1280 px window with the panel docked (676) and a 768 px tablet (564)', () => {
    expect(chooseBodyLayout({ widthPx: 739, checkCount: 2, phaseType: 'loading' })).toBe('stacked')
    expect(chooseBodyLayout({ widthPx: 676, checkCount: 2, phaseType: 'loading' })).toBe('stacked')
    expect(chooseBodyLayout({ widthPx: 564, checkCount: 2, phaseType: 'loading' })).toBe('stacked')
  })

  it('stacks a card with nothing in Checked, however wide', () => {
    expect(chooseBodyLayout({ widthPx: 1200, checkCount: 0, phaseType: 'arrival' })).toBe('stacked')
  })

  it('stacks an in_transit card at any width: its Checked column holds one standing line', () => {
    expect(chooseBodyLayout({ widthPx: 1200, checkCount: 1, phaseType: 'in_transit' })).toBe('stacked')
  })

  it('stacks before the first measurement rather than guessing', () => {
    expect(chooseBodyLayout({ widthPx: null, checkCount: 3, phaseType: 'loading' })).toBe('stacked')
  })
})

describe('realCheckCount', () => {
  const line = (result: PhaseCheck['result']): PhaseCheck => ({ key: 'parcels', result, title: 't', detail: 'd' })

  it('counts passes, flags and checks that could not run, but not a live scan line', () => {
    expect(realCheckCount([line('pass'), line('flag'), line('not_checked')])).toBe(3)
    expect(realCheckCount([line('in_progress')])).toBe(0)
    expect(realCheckCount([line('in_progress'), line('pass')])).toBe(1)
  })

  it('keeps a card whose only line is a running scan from splitting', () => {
    const checkCount = realCheckCount([line('in_progress')])

    expect(chooseBodyLayout({ widthPx: 1200, checkCount, phaseType: 'unloading' })).toBe('stacked')
  })
})
