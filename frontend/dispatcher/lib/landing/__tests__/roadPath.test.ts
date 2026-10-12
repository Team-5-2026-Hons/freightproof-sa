import { describe, expect, it } from 'vitest'
import {
  buildRoadPath,
  cameraFraction,
  headingDegrees,
  lengthAtY,
  pointAtLength,
  stepCriticalSpring,
  type RoadSample,
} from '../roadPath'

// A straight vertical road sampled every 10px: length and y advance together.
const straight: RoadSample[] = Array.from({ length: 11 }, (_, i) => ({ length: i * 10, x: 50, y: 100 + i * 10 }))

describe('buildRoadPath', () => {
  it('build_empty_points_gives_empty_path', () => {
    expect(buildRoadPath([])).toBe('')
  })

  it('build_single_point_is_a_move_only', () => {
    expect(buildRoadPath([{ x: 10, y: 20 }])).toBe('M 10 20')
  })

  it('build_segments_leave_and_enter_vertically', () => {
    const d = buildRoadPath([{ x: 0, y: 0 }, { x: 100, y: 200 }], 0.5)

    // Handles share x with their endpoint, so the tangent at each checkpoint is vertical.
    expect(d).toBe('M 0 0 C 0 100, 100 100, 100 200')
  })
})

describe('lengthAtY / pointAtLength', () => {
  it('length_clamps_above_and_below_the_road', () => {
    expect(lengthAtY(straight, 0)).toBe(0)
    expect(lengthAtY(straight, 9999)).toBe(100)
  })

  it('length_interpolates_between_samples', () => {
    expect(lengthAtY(straight, 145)).toBeCloseTo(45)
  })

  it('point_interpolates_and_round_trips_with_length', () => {
    const p = pointAtLength(straight, 37)

    expect(p).toEqual({ x: 50, y: 137 })
    expect(lengthAtY(straight, p.y)).toBeCloseTo(37)
  })

  it('point_clamps_out_of_range_lengths', () => {
    expect(pointAtLength(straight, -5)).toEqual({ x: 50, y: 100 })
    expect(pointAtLength(straight, 500)).toEqual({ x: 50, y: 200 })
  })

  it('empty_samples_are_safe', () => {
    expect(lengthAtY([], 10)).toBe(0)
    expect(pointAtLength([], 10)).toEqual({ x: 0, y: 0 })
  })
})

describe('headingDegrees', () => {
  it('heading_straight_down_is_zero', () => {
    expect(headingDegrees({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0)
  })

  it('heading_down_and_right_turns_the_truck_clockwise_from_its_own_view', () => {
    expect(headingDegrees({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(-45)
    expect(headingDegrees({ x: 0, y: 0 }, { x: -10, y: 10 })).toBeCloseTo(45)
  })
})

describe('cameraFraction', () => {
  it('camera_starts_low_and_settles_mid_screen', () => {
    expect(cameraFraction(0, 1000)).toBeCloseTo(0.86)
    expect(cameraFraction(10_000, 1000)).toBeCloseTo(0.55)
  })

  it('camera_moves_monotonically_while_settling', () => {
    const values = [0, 100, 200, 300, 400, 500, 600].map(y => cameraFraction(y, 1000))

    values.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(values[i]))
  })

  it('camera_handles_zero_height_viewport', () => {
    expect(cameraFraction(100, 0)).toBe(0.55)
  })
})

describe('stepCriticalSpring', () => {
  it('spring_with_zero_time_does_not_move', () => {
    const next = stepCriticalSpring({ value: 0, velocity: 0 }, 100, 0, 0.2)

    expect(next).toEqual({ value: 0, velocity: 0 })
  })

  it('spring_approaches_target_without_overshooting', () => {
    let state = { value: 0, velocity: 0 }
    let max = 0
    for (let frame = 0; frame < 120; frame++) {
      state = stepCriticalSpring(state, 100, 1 / 60, 0.2)
      max = Math.max(max, state.value)
    }

    expect(state.value).toBeCloseTo(100, 2)
    expect(max).toBeLessThanOrEqual(100 + 1e-6)
  })

  it('spring_is_stable_across_a_long_dropped_frame', () => {
    const next = stepCriticalSpring({ value: 0, velocity: 0 }, 100, 5, 0.2)

    expect(Number.isFinite(next.value)).toBe(true)
    expect(next.value).toBeCloseTo(100, 3)
  })

  it('spring_reversal_continues_from_current_value', () => {
    const moving = stepCriticalSpring({ value: 0, velocity: 0 }, 100, 0.05, 0.2)
    const reversed = stepCriticalSpring(moving, 0, 1 / 60, 0.2)

    // One frame after the target flips, the truck is still near where it was, not snapped back.
    expect(Math.abs(reversed.value - moving.value)).toBeLessThan(10)
  })
})
