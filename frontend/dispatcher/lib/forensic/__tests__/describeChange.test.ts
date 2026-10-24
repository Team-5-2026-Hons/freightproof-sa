import { describe, expect, it } from 'vitest'

import { describeChange } from '../describeChange'

const BOX = [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]]

describe('describeChange property outlines', () => {
  it('test_summarises_an_outline_diff_by_corner_count', () => {
    expect(describeChange({ geofence_polygon: { from: null, to: BOX } })).toEqual([
      { label: 'Property outline', value: 'None (radius applies) → 4 corners' },
    ])
  })

  it('test_summarises_an_outline_in_a_creation_snapshot', () => {
    expect(describeChange({ geofence_polygon: BOX, geofence_radius_metres: 200 })).toEqual([
      { label: 'Property outline', value: '4 corners' },
      { label: 'Geofence radius (m)', value: '200' },
    ])
  })
})

describe('describeChange booleans', () => {
  it('test_renders_a_non_status_boolean_as_yes_or_no', () => {
    expect(describeChange({ is_shared: true })).toEqual([
      { label: 'Shared with other organisations', value: 'Yes' },
    ])
    expect(describeChange({ is_shared: { from: true, to: false } })).toEqual([
      { label: 'Shared with other organisations', value: 'Yes → No' },
    ])
  })

  it('test_keeps_active_and_inactive_for_is_active', () => {
    expect(describeChange({ is_active: false })).toEqual([{ label: 'Active', value: 'Inactive' }])
    expect(describeChange({ is_active: { from: false, to: true } })).toEqual([
      { label: 'Active', value: 'Inactive → Active' },
    ])
  })

  it('test_applies_the_same_wording_inside_a_cosmetic_patch', () => {
    expect(describeChange({ _no_critical_change: true, _patch: { is_shared: true, is_active: true } })).toEqual([
      { label: 'Shared with other organisations', value: 'Yes' },
      { label: 'Active', value: 'Active' },
    ])
  })
})
