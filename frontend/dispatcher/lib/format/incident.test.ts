import { describe, expect, it } from 'vitest'
import type { IncidentUpdate } from '@/lib/types/incident'
import {
  SCAN_STATE_LABELS,
  describeUpdate,
  incidentTypeForException,
  reportDefaults,
  tripIsLive,
} from './incident'

function update(overrides: Partial<IncidentUpdate>): IncidentUpdate {
  return {
    update_id: 'u1', sequence: 1, kind: 'note', note: null, from_value: null, to_value: null, parcel_id: null,
    exception_id: null, phase_event_id: null, artifact_id: null, external_action: null, action_at: null,
    recorded_by_user_id: 'd1', recorded_by_name: 'Dispatcher', recorded_at: '2026-10-20T10:00:00Z', ...overrides,
  }
}

describe('reportDefaults', () => {
  it('stops a live trip and names every parcel for a hijacking', () => {
    expect(reportDefaults('hijacking', 'active')).toEqual({ stopTrip: true, allParcels: true })
  })

  it('never stops a trip that already ended', () => {
    expect(reportDefaults('hijacking', 'closed').stopTrip).toBe(false)
    expect(reportDefaults('hijacking', 'cancelled').stopTrip).toBe(false)
  })

  it('leaves a shortage running with no parcels preselected', () => {
    expect(reportDefaults('parcel_shortage', 'active')).toEqual({ stopTrip: false, allParcels: false })
  })
})

describe('tripIsLive', () => {
  it('treats created, active and held trips as live', () => {
    expect(tripIsLive('created')).toBe(true)
    expect(tripIsLive('active')).toBe(true)
    expect(tripIsLive('exception_hold')).toBe(true)
    expect(tripIsLive('closed')).toBe(false)
  })
})

describe('incidentTypeForException', () => {
  it('suggests a hijacking for a panic alert and a shortage for a short count', () => {
    expect(incidentTypeForException('panic_button')).toBe('hijacking')
    expect(incidentTypeForException('parcel_count_mismatch')).toBe('parcel_shortage')
    expect(incidentTypeForException('cargo_damage')).toBe('parcel_damage')
  })

  it('falls back to a shortage for an unmapped exception', () => {
    expect(incidentTypeForException('seal_compromised')).toBe('parcel_shortage')
  })
})

describe('describeUpdate', () => {
  it('names the assignee when known', () => {
    const names = new Map([['d2', 'Thandi']])

    expect(describeUpdate(update({ kind: 'assigned', to_value: 'd2' }), names)).toBe('Assigned to Thandi')
    expect(describeUpdate(update({ kind: 'assigned', to_value: null }), names)).toBe('Unassigned')
  })

  it('reads findings, outcomes and external actions in plain words', () => {
    expect(describeUpdate(update({ kind: 'parcel_finding', to_value: 'confirmed_missing' }))).toBe('Parcel finding: confirmed missing')
    expect(describeUpdate(update({ kind: 'closed', to_value: 'partial_recovery' }))).toBe('Closed as partial recovery')
    expect(describeUpdate(update({ kind: 'external_action', external_action: 'saps_reported' }))).toBe('Reported to SAPS')
  })
})

describe('scan state labels', () => {
  it('state scan facts and never a theft conclusion', () => {
    for (const text of Object.values(SCAN_STATE_LABELS)) expect(text.toLowerCase()).not.toContain('stolen')
    expect(SCAN_STATE_LABELS.no_scan_in_recorded).toBe('No scan-in recorded')
  })
})
