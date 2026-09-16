import { describe, expect, it, vi } from 'vitest'

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

/** Clicks the popup's "Open" link and reports whether the popup's own handler took the click
 *  over. Every click is cancelled at the document afterwards, so jsdom never tries to follow
 *  the link itself. */
function clickOpen(popup: HTMLElement, init: MouseEventInit = {}): boolean {
  const link = popup.querySelector('a')
  if (link === null) throw new Error('popup has no link')
  let handled = false
  const record = (event: Event): void => {
    handled = event.defaultPrevented
    event.preventDefault()
  }
  document.body.append(popup)
  document.addEventListener('click', record)
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))
  document.removeEventListener('click', record)
  popup.remove()
  return handled
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

  it('opens the report inside the app on a plain click, so the page never reloads', () => {
    const onOpen = vi.fn()
    const popup = buildPinPopup(makePin(), '/analytics?tab=routes', onOpen)

    const handled = clickOpen(popup)

    expect(handled).toBe(true)
    expect(onOpen).toHaveBeenCalledWith('/exceptions/exc-1?returnTo=%2Fanalytics%3Ftab%3Droutes')
  })

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
  ] as const)('leaves a %s-click to the browser, so a new tab or window still works', (_key, init) => {
    const onOpen = vi.fn()
    const popup = buildPinPopup(makePin(), undefined, onOpen)

    const handled = clickOpen(popup, init)

    expect(handled).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('stays an ordinary link when no in-app handler is given', () => {
    const popup = buildPinPopup(makePin())

    expect(clickOpen(popup)).toBe(false)
    expect(popup.querySelector('a')?.getAttribute('href')).toBe('/exceptions/exc-1')
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
