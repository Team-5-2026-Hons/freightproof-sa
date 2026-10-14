// A minimal damped spring, in Apple's own parameters (WWDC 2018, "Designing Fluid
// Interfaces"): `response` is roughly how long the motion takes, in seconds, and
// `dampingRatio` is how much it overshoots (1 = settles with no bounce, < 1 = bounces).
//
// Hand-rolled rather than a library because the driver app needs exactly one behaviour —
// a thumb that springs to a target carrying the finger's release velocity — and that is
// ~40 lines of physics, not a dependency. Unlike a CSS transition, a spring starts from
// wherever the element is and from however fast it was moving, so a release never "jumps"
// and an animation can be grabbed and redirected mid-flight.

export interface SpringConfig {
  /** Approximate settle time in seconds. Lower is snappier. */
  response: number
  /** 1 = critically damped (no overshoot). Below 1 overshoots. */
  dampingRatio: number
}

/** Default for UI that was not thrown: settles without overshoot. */
export const SPRING_SETTLE: SpringConfig = { response: 0.35, dampingRatio: 1 }

/** Apple's drawer/sheet spring — a little bounce, for motion a flick set going. */
export const SPRING_FLICK: SpringConfig = { response: 0.3, dampingRatio: 0.8 }

// Close enough to rest to snap and stop: half a pixel, barely moving.
const REST_DISTANCE_PX = 0.5
const REST_VELOCITY_PX_S = 10

// A dropped frame (tab backgrounded, main thread busy) must not integrate one huge step
// and fling the value past its target.
const MAX_STEP_S = 1 / 30

interface AnimateSpringOptions {
  from: number
  to: number
  /** Initial velocity in px/s — the finger's speed at release. */
  velocity: number
  config: SpringConfig
  onUpdate: (value: number) => void
  onComplete?: () => void
}

/** Starts the spring and returns a function that cancels it where it stands. */
export function animateSpring({ from, to, velocity, config, onUpdate, onComplete }: AnimateSpringOptions): () => void {
  const stiffness = (2 * Math.PI / config.response) ** 2
  const damping = (4 * Math.PI * config.dampingRatio) / config.response

  let position = from
  let speed = velocity
  let last: number | null = null
  let frame = 0

  function step(now: number) {
    const dt = last === null ? 1 / 60 : Math.min((now - last) / 1000, MAX_STEP_S)
    last = now

    // Semi-implicit Euler: update velocity from the spring force first, then position
    // from the new velocity. Stable at UI frame rates, unlike the explicit form.
    const force = -stiffness * (position - to) - damping * speed
    speed += force * dt
    position += speed * dt

    if (Math.abs(position - to) < REST_DISTANCE_PX && Math.abs(speed) < REST_VELOCITY_PX_S) {
      onUpdate(to)
      onComplete?.()
      return
    }
    onUpdate(position)
    frame = requestAnimationFrame(step)
  }

  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

/**
 * Where a flick would come to rest if left to decelerate like a scroll view — Apple's
 * projection function from the same talk. Used to decide what a release *meant*, not
 * just where the finger happened to lift.
 */
export function projectMomentum(velocityPxPerS: number, decelerationRate = 0.998): number {
  return ((velocityPxPerS / 1000) * decelerationRate) / (1 - decelerationRate)
}

/**
 * Soft resistance past a boundary: the further past it, the less the element follows.
 * A hard stop reads as frozen; this reads as "responsive, but there is nothing more".
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}
