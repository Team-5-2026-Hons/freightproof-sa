import { describe, expect, it } from 'vitest'

import type { OpenPageAction } from '@shared/lib/types/assistant'
import { hrefForAction } from './links'

function page(overrides: Partial<OpenPageAction>): OpenPageAction {
  return { kind: 'open_page', label: 'Open', page: 'dashboard', record_id: null, filters: {}, ...overrides }
}

describe('assistant button links', () => {
  it('opens record pages by id', () => {
    expect(hrefForAction(page({ page: 'driver', record_id: 'd-1' }))).toBe('/fleet/drivers/d-1')
    expect(hrefForAction(page({ page: 'vehicle', record_id: 'v-1' }))).toBe('/fleet/vehicles/v-1')
    expect(hrefForAction(page({ page: 'trip', record_id: 't-1' }))).toBe('/trips/t-1')
  })

  it('falls back to the list when a record page has no id (a trip to the Dashboard: there is no trips list)', () => {
    expect(hrefForAction(page({ page: 'driver' }))).toBe('/fleet/drivers')
    expect(hrefForAction(page({ page: 'trip' }))).toBe('/')
  })

  it("keeps only filters the page reads, and drops the rest", () => {
    expect(hrefForAction(page({ page: 'exceptions', filters: { severity: 'critical', evil: 'x' } }))).toBe('/exceptions?severity=critical')
    expect(hrefForAction(page({ page: 'dashboard', filters: { severity: 'critical' } }))).toBe('/')
  })

  it('opens the Add forms, empty: nothing a server reply carried reaches them', () => {
    expect(hrefForAction(page({ page: 'add_precinct', filters: { name: 'x' } }))).toBe('/precincts/new')
    expect(hrefForAction(page({ page: 'add_driver', filters: { id_number: '8001015009087' } }))).toBe('/fleet/drivers?add=1')
    expect(hrefForAction(page({ page: 'add_vehicle' }))).toBe('/fleet/vehicles?add=1')
  })

  it('carries the question to Analytics', () => {
    expect(hrefForAction(page({ page: 'analytics', filters: { ask: "What's our on-time rate?" } })))
      .toBe('/analytics?ask=What%27s+our+on-time+rate%3F')
  })
})
