import { describe, expect, it } from 'vitest'

import { buildTripPanelQuery } from './panel-query'

describe('buildTripPanelQuery', () => {
  it('builds the phase-scoped exceptions view exactly as the timeline did before exception selection existed', () => {
    const query = buildTripPanelQuery('', { panel: 'exceptions', filter: 'all', phaseId: 'p-1' })

    expect(query).toBe('panel=exceptions&exceptions=all&phase=p-1')
  })

  it('adds the exception id after the phase so one record can be selected inside its phase', () => {
    const query = buildTripPanelQuery('', { panel: 'exceptions', filter: 'all', phaseId: 'p-1', exceptionId: 'e-1' })

    expect(query).toBe('panel=exceptions&exceptions=all&phase=p-1&exception=e-1')
  })

  it('drops the phase filter for a trip-level exception, which belongs to no phase', () => {
    const query = buildTripPanelQuery('panel=exceptions&exceptions=all&phase=p-1', { panel: 'exceptions', filter: 'all', phaseId: null, exceptionId: 'e-1' })

    expect(query).toBe('panel=exceptions&exceptions=all&exception=e-1')
  })

  it('drops a previously selected exception when the call is the phase-only "+n more" form', () => {
    const query = buildTripPanelQuery('panel=exceptions&exception=e-1', { panel: 'exceptions', filter: 'all', phaseId: 'p-2', exceptionId: null })

    expect(query).toBe('panel=exceptions&exceptions=all&phase=p-2')
  })

  it('keeps the phase and the exception when a change does not mention them', () => {
    const query = buildTripPanelQuery('panel=exceptions&exceptions=all&phase=p-1&exception=e-1', { panel: 'exceptions', filter: 'all' })

    expect(query).toBe('panel=exceptions&exceptions=all&phase=p-1&exception=e-1')
  })

  it('clears the exception without touching the phase', () => {
    const query = buildTripPanelQuery('panel=exceptions&exceptions=all&phase=p-1&exception=e-1', { panel: 'exceptions', exceptionId: null })

    expect(query).toBe('panel=exceptions&exceptions=all&phase=p-1')
  })

  it.each(['information', 'manifest', 'audit', null])('forgets the phase and exception when the panel becomes %s', panel => {
    const query = buildTripPanelQuery('panel=exceptions&exceptions=all&phase=p-1&exception=e-1&returnTo=%2Ftrips', { panel })

    expect(query).not.toContain('phase=')
    expect(query).not.toContain('exception=e-1')
    expect(query).toContain('returnTo=%2Ftrips')
  })
})
