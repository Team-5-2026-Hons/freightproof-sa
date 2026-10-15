import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPRING_FLICK, SPRING_SETTLE, animateSpring, projectMomentum, rubberband } from '@/lib/motion/spring'

// Drives requestAnimationFrame by hand at a steady 60fps, so the physics can be stepped
// deterministically without depending on how the test environment schedules frames.
const FRAME_MS = 1000 / 60
let queue: FrameRequestCallback[] = []
let clock = 0

function runFrames(count: number) {
  for (let i = 0; i < count && queue.length > 0; i++) {
    clock += FRAME_MS
    const callbacks = queue
    queue = []
    callbacks.forEach((cb) => cb(clock))
  }
}

beforeEach(() => {
  queue = []
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb)
    return queue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = []
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('animateSpring', () => {
  it('settles exactly on the target and reports completion', () => {
    // Arrange
    const values: number[] = []
    const onComplete = vi.fn()

    // Act — two seconds of frames is far longer than a 0.35s response needs.
    animateSpring({ from: 0, to: 300, velocity: 0, config: SPRING_SETTLE, onUpdate: (v) => values.push(v), onComplete })
    runFrames(120)

    // Assert
    expect(values.at(-1)).toBe(300)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not overshoot when critically damped', () => {
    // Arrange
    const values: number[] = []

    // Act
    animateSpring({ from: 0, to: 300, velocity: 0, config: SPRING_SETTLE, onUpdate: (v) => values.push(v) })
    runFrames(120)

    // Assert
    expect(Math.max(...values)).toBeLessThanOrEqual(300)
  })

  it('carries the release velocity: a thrown value first moves the way it was thrown', () => {
    // Arrange — heading back to 0, but released moving forward fast.
    const values: number[] = []

    // Act
    animateSpring({ from: 100, to: 0, velocity: 2000, config: SPRING_FLICK, onUpdate: (v) => values.push(v) })
    runFrames(3)

    // Assert — no hard reversal at release; the momentum is honoured first.
    expect(values[0]).toBeGreaterThan(100)
  })

  it('stops where it stands when cancelled', () => {
    // Arrange
    const onUpdate = vi.fn()
    const cancel = animateSpring({ from: 0, to: 300, velocity: 0, config: SPRING_SETTLE, onUpdate })
    runFrames(2)
    const callsBefore = onUpdate.mock.calls.length

    // Act
    cancel()
    runFrames(10)

    // Assert
    expect(onUpdate.mock.calls.length).toBe(callsBefore)
  })
})

describe('projectMomentum', () => {
  it('projects a flick forward in proportion to its speed', () => {
    expect(projectMomentum(1000)).toBeCloseTo(499, 0)
    expect(projectMomentum(0)).toBe(0)
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 0)
  })
})

describe('rubberband', () => {
  it('always moves less than the overshoot, and less and less as it grows', () => {
    // Arrange
    const dimension = 400

    // Act
    const small = rubberband(20, dimension)
    const large = rubberband(400, dimension)

    // Assert
    expect(small).toBeLessThan(20)
    expect(large).toBeLessThan(400)
    expect(large / 400).toBeLessThan(small / 20)
  })
})
