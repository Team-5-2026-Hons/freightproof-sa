import { describe, expect, it } from 'vitest'

import type { IncidentPin } from '@shared/lib/types/fleet-analytics'
import { PIN_STYLE, buildPinPopup } from './IncidentMap'

function makePin(overrides: Partial<IncidentPin> = {}): IncidentPin {
  return {
    exception_id: 'exc-1' as IncidentPin['exception_id'],
    trip_id: 'trip-1' as IncidentPin['trip_id'],
    trip_reference: 'FP-2026-0042',
    exception_type: 'panic_button',
    severity: 'critical',
    created_at: '2026-09-08T07:00:00Z',
    lat: -26.2041,
    lng: 28.0473,
    ...overrides,
  }
}

describe('IncidentMap pins', () => {
  it('builds a popup with the type, severity, day, trip and a link to the report', () => {
    const popup = buildPinPopup(makePin())

    expect(popup.textContent).toContain('Panic Button')
    expect(popup.textContent).toContain('Critical · 8 Sep 2026 · FP-2026-0042')
    expect(popup.querySelector('a')?.getAttribute('href')).toBe('/exceptions/exc-1')
  })

  it('gives the report link a way back to where the map was opened from', () => {
    const popup = buildPinPopup(makePin(), '/analytics?tab=routes&period=last_4_weeks')

    expect(popup.querySelector('a')?.getAttribute('href'))
      .toBe('/exceptions/exc-1?returnTo=%2Fanalytics%3Ftab%3Droutes%26period%3Dlast_4_weeks')
  })

  it('sets popup text as text, never as markup', () => {
    const popup = buildPinPopup(makePin({ trip_reference: '<img src=x onerror=alert(1)>' }))

    expect(popup.querySelector('img')).toBeNull()
    expect(popup.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('never tells severities apart by colour alone', () => {
    expect(PIN_STYLE.warning.glyph).not.toBe(PIN_STYLE.critical.glyph)
    expect(PIN_STYLE.warning.className).toContain('bg-warn-c')
    expect(PIN_STYLE.critical.className).toContain('bg-err')
  })
})
