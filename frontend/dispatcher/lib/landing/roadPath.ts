// Geometry and physics for the landing page's scroll-driven truck. Kept free of the DOM
// so the parts that decide where the truck is can be tested without a browser.

export interface Point {
  x: number
  y: number
}

/** One sample along the drawn road: distance travelled, and position at that distance. */
export interface RoadSample extends Point {
  length: number
}

/**
 * Smooth road through `points` (top to bottom). Each segment leaves and enters its
 * checkpoints travelling straight down, so the truck is always upright at a checkpoint
 * and the swing between them reads as a bend in the road rather than a zig-zag.
 * `bend` (0–1) is how far down each segment the handles reach; 0.5 gives an even S.
 */
export function buildRoadPath(points: readonly Point[], bend = 0.5): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  let d = `M ${round(first.x)} ${round(first.y)}`
  let previous = first
  for (const point of rest) {
    const reach = (point.y - previous.y) * bend
    d += ` C ${round(previous.x)} ${round(previous.y + reach)}, ${round(point.x)} ${round(point.y - reach)}, ${round(point.x)} ${round(point.y)}`
    previous = point
  }
  return d
}

/**
 * Distance along the road at which it reaches height `y`. Relies on the road only ever
 * heading downhill (true for every path buildRoadPath makes), so y is monotonic in length
 * and a binary search is exact up to the sampling interval, refined by interpolation.
 */
export function lengthAtY(samples: readonly RoadSample[], y: number): number {
  if (samples.length === 0) return 0
  if (y <= samples[0].y) return samples[0].length
  const last = samples[samples.length - 1]
  if (y >= last.y) return last.length

  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].y <= y) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const span = b.y - a.y
  const t = span === 0 ? 0 : (y - a.y) / span
  return a.length + (b.length - a.length) * t
}

/** Position at a distance along the road, interpolated between the two nearest samples. */
export function pointAtLength(samples: readonly RoadSample[], length: number): Point {
  if (samples.length === 0) return { x: 0, y: 0 }
  if (length <= samples[0].length) return { x: samples[0].x, y: samples[0].y }
  const last = samples[samples.length - 1]
  if (length >= last.length) return { x: last.x, y: last.y }

  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].length <= length) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const t = (length - a.length) / (b.length - a.length)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Heading in degrees (0 = travelling straight down the page) between two nearby points. */
export function headingDegrees(from: Point, to: Point): number {
  // atan2(dx, dy) rather than (dy, dx): the truck artwork faces down the page, so
  // "straight down" is the zero heading and bends to the right are negative.
  return -(Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI
}

// Where on screen the truck rides, as a fraction of viewport height. At the very top of
// the page the road only just peeks above the fold, so the line starts low (the truck
// moves with the first flick of the wheel) and settles at mid-screen once the visitor
// is scrolling through the journey.
const CAMERA_START = 0.86
const CAMERA_CRUISE = 0.55
const CAMERA_SETTLE_VIEWPORTS = 0.6

export function cameraFraction(scrollY: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return CAMERA_CRUISE
  const t = Math.min(Math.max(scrollY / (viewportHeight * CAMERA_SETTLE_VIEWPORTS), 0), 1)
  const eased = t * t * (3 - 2 * t)
  return CAMERA_START + (CAMERA_CRUISE - CAMERA_START) * eased
}

export interface SpringState {
  value: number
  velocity: number
}

/**
 * One step of a critically damped spring (damping ratio 1, so no overshoot), solved in
 * closed form rather than integrated — exact for any frame time, so a dropped frame
 * can't make it unstable. `response` is Apple's term: roughly how long, in seconds, the
 * value takes to catch up. The spring starts from wherever the truck is now, so a scroll
 * that reverses mid-motion is followed continuously, never restarted.
 */
export function stepCriticalSpring(state: SpringState, target: number, dtSeconds: number, response: number): SpringState {
  const omega = (2 * Math.PI) / response
  const offset = state.value - target
  const c2 = state.velocity + omega * offset
  const decay = Math.exp(-omega * dtSeconds)
  return {
    value: target + (offset + c2 * dtSeconds) * decay,
    velocity: (c2 - omega * (offset + c2 * dtSeconds)) * decay,
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
