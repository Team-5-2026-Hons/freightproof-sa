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
