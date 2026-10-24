import { describe, expect, it } from 'vitest'

import { analyticsReturnHref, controlsFromSearch, hasReturnedControls, mapWindowFromSearch } from './navigation'

function search(href: string): URLSearchParams {
  return new URLSearchParams(href.split('?')[1] ?? '')
}

describe('analytics return address', () => {
  it('carries the tab, View by and period', () => {
    expect(analyticsReturnHref('routes', { grain: 'week', period: { preset: 'last_26_weeks' } }))
      .toBe('/analytics?tab=routes&grain=week&period=last_26_weeks')
  })

  it('carries both dates of a custom range', () => {
    expect(analyticsReturnHref('problems', { grain: 'month', period: { preset: 'custom', start: '2026-03-01', end: '2026-08-31' } }))
      .toBe('/analytics?tab=problems&grain=month&period=custom&start=2026-03-01&end=2026-08-31')
  })

  it('reads back exactly what it wrote', () => {
    const custom = { grain: 'month', period: { preset: 'custom', start: '2026-03-01', end: '2026-08-31' } } as const
    const preset = { grain: 'year', period: { preset: 'last_3_years' } } as const

    expect(controlsFromSearch(search(analyticsReturnHref('problems', custom)))).toEqual(custom)
    expect(controlsFromSearch(search(analyticsReturnHref('evidence', preset)))).toEqual(preset)
  })

  it('knows a plain tab address from a return address', () => {
    expect(hasReturnedControls(search('/analytics?tab=routes'))).toBe(false)
    expect(hasReturnedControls(search('/analytics?tab=routes&grain=week&period=all_time'))).toBe(true)
  })

  it('carries the incident map window only when it is Today', () => {
    const controls = { grain: 'week', period: { preset: 'last_12_weeks' } } as const

    expect(analyticsReturnHref('routes', controls, 'today'))
      .toBe('/analytics?tab=routes&grain=week&period=last_12_weeks&map=today')
    expect(analyticsReturnHref('routes', controls, 'period')).not.toContain('map=')
    expect(analyticsReturnHref('routes', controls)).not.toContain('map=')
  })

  it('reads the map window back, and treats anything it did not write as This period', () => {
    expect(mapWindowFromSearch(search('/analytics?tab=routes&map=today'))).toBe('today')
    expect(mapWindowFromSearch(search('/analytics?tab=routes'))).toBe('period')
    expect(mapWindowFromSearch(search('/analytics?tab=routes&map=period'))).toBe('period')
    expect(mapWindowFromSearch(search('/analytics?tab=routes&map=yesterday'))).toBe('period')
    expect(mapWindowFromSearch(search('/analytics?tab=routes&map='))).toBe('period')
  })

  it('ignores choices that make no sense rather than guessing', () => {
    expect(controlsFromSearch(search('/analytics?tab=routes'))).toBeNull()
    expect(controlsFromSearch(search('/analytics?grain=fortnight&period=all_time'))).toBeNull()
    expect(controlsFromSearch(search('/analytics?grain=week&period=last_99_weeks'))).toBeNull()
    expect(controlsFromSearch(search('/analytics?grain=week&period=custom&start=2026-09-01'))).toBeNull()
    expect(controlsFromSearch(search('/analytics?grain=week&period=custom&start=2026-09-10&end=2026-09-01'))).toBeNull()
    expect(controlsFromSearch(search('/analytics?grain=week&period=custom&start=yesterday&end=2026-09-01'))).toBeNull()
  })
})
