// The TypeScript twin of backend/app/core/polygon.py. The figures here match the backend
// suite (tests/unit/test_polygon.py) on purpose: the two must agree on every verdict.
import { describe, expect, it } from 'vitest'

import {
  areaSquareMetres,
  contains,
  describeGeofence,
  describeOutline,
  distanceToBoundaryMetres,
  enclosingRadiusMetres,
  isSimple,
  outsideByMetres,
  rectangleAround,
  validateOutline,
} from '../polygon'
import type { LatLngPair } from '@shared/lib/types/precinct'

const BOX: LatLngPair[] = [[-29.7937, 30.9815], [-29.7937, 30.9825], [-29.7947, 30.9825], [-29.7947, 30.9815]]
const CENTRE: LatLngPair = [-29.7942, 30.982]
const L_SHAPE: LatLngPair[] = [
  [-29.79, 30.98], [-29.79, 30.984], [-29.791, 30.984], [-29.791, 30.981], [-29.794, 30.981], [-29.794, 30.98],
]

describe('outline geometry', () => {
  it('test_contains_inside_outside_and_concave_notch', () => {
    expect(contains(BOX, CENTRE)).toBe(true)
    expect(contains(BOX, [-29.7942, 30.984])).toBe(false)
    expect(contains(L_SHAPE, [-29.793, 30.983])).toBe(false)
    expect(contains(L_SHAPE, [-29.7905, 30.983])).toBe(true)
  })

  it('test_distance_to_boundary_matches_the_backend', () => {
    expect(distanceToBoundaryMetres(BOX, [-29.7942, 30.9835])).toBeCloseTo(96.6, 0)
    expect(distanceToBoundaryMetres(BOX, CENTRE)).toBeCloseTo(48.3, 0)
    expect(outsideByMetres(BOX, CENTRE)).toBe(0)
  })

  it('test_area_is_width_times_height_and_order_independent', () => {
    expect(areaSquareMetres(BOX)).toBeCloseTo(96.6 * 111.2, -2)
    expect(areaSquareMetres([...BOX].reverse())).toBeCloseTo(areaSquareMetres(BOX), 6)
  })

  it('test_is_simple_rejects_figure_of_eight_and_repeats', () => {
    expect(isSimple(BOX)).toBe(true)
    expect(isSimple(L_SHAPE)).toBe(true)
    expect(isSimple([BOX[0], BOX[2], BOX[1], BOX[3]])).toBe(false)
    expect(isSimple([BOX[0], BOX[1], BOX[1], BOX[2]])).toBe(false)
  })

  it('test_rectangle_around_is_about_100_m_square_and_holds_the_point', () => {
    const square = rectangleAround(CENTRE[0], CENTRE[1])

    expect(contains(square, CENTRE)).toBe(true)
    expect(Math.sqrt(areaSquareMetres(square))).toBeCloseTo(100, 0)
  })

  it('test_enclosing_radius_reaches_the_farthest_corner', () => {
    expect(enclosingRadiusMetres(BOX, CENTRE)).toBeCloseTo(73.6, 0)
  })
})

describe('validateOutline (mirrors schemas/organisations.py)', () => {
  it('test_accepts_a_valid_outline_with_the_pin_inside', () => {
    expect(validateOutline(BOX, CENTRE)).toBeNull()
  })

  it('test_rejects_each_server_rule_with_the_same_wording', () => {
    expect(validateOutline(BOX.slice(0, 2), CENTRE)).toMatch(/at least 3/)
    expect(validateOutline([BOX[0], BOX[2], BOX[1], BOX[3]], CENTRE)).toMatch(/crosses itself/)
    expect(validateOutline(rectangleAround(CENTRE[0], CENTRE[1], 5), CENTRE)).toMatch(/too small/)
    expect(validateOutline(rectangleAround(CENTRE[0], CENTRE[1], 10_000), CENTRE)).toMatch(/too large/)
    expect(validateOutline(BOX, [-29.80, 30.99])).toMatch(/outside the outline/)
  })

  it('test_allows_a_gate_pin_just_outside_the_outline', () => {
    expect(validateOutline(BOX, [-29.7942, 30.9828])).toBeNull()
  })
})

describe('labels', () => {
  it('test_describes_an_outline_by_corners_and_area', () => {
    expect(describeOutline(BOX)).toBe('Outline · 4 corners · 1.1 ha')
  })

  it('test_describe_geofence_falls_back_to_the_radius', () => {
    expect(describeGeofence({ geofence_radius_metres: 200, geofence_polygon: null })).toBe('200 m')
    expect(describeGeofence({ geofence_radius_metres: 200 })).toBe('200 m')
    expect(describeGeofence({ geofence_radius_metres: 200, geofence_polygon: BOX })).toMatch(/^Outline · 4 corners/)
  })
})
