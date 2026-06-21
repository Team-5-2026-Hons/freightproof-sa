import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'

type Handshake = 1 | 2 | 3 | 4 | 5

/**
 * Given where the driver is now (handshake + step slug), return the route for the NEXT
 * screen. Navigation is a pure function of the URL, so a refresh or deep-link can never
 * desync "which step am I on". This is presentation flow only — the backend remains the
 * authority on whether the handshake is actually valid and anchored.
 *
 * @throws {Error} if `slug` is not a recognized step for `handshake` — e.g. a stale
 * deep link, bookmark, or typo'd URL. Failing loud here prevents silently routing the
 * driver past an entire handshake (see Task 5b review).
 */
export function nextHandshakeRoute(tripId: string, handshake: Handshake, slug: string): string {
  const slugs = STEP_SLUGS[handshake]
  const stepIndex = slugs.indexOf(slug)                       // 0-based; -1 if unknown

  if (stepIndex === -1) {
    throw new Error(`Unknown step slug "${slug}" for handshake ${handshake}`)
  }

  const isLastStep = stepIndex === slugs.length - 1

  // Mid-handshake — next step of the same handshake.
  if (!isLastStep) {
    return ROUTES.handshakeStep(tripId, handshake, slugs[stepIndex + 1])
  }
  // End of Origin Gate-Out (H3): the driver departs — hand off to the in-transit hub.
  if (handshake === 3) {
    return ROUTES.inTransit(tripId)
  }
  // End of H1/H2/H4 — first step of the next handshake.
  if (handshake < 5) {
    const next = (handshake + 1) as Handshake
    return ROUTES.handshakeStep(tripId, next, STEP_SLUGS[next][0])
  }
  // End of Unloading (H5): the trip is closed — back to the trip list.
  return ROUTES.trips
}
