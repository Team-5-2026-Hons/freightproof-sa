import { ROUTES } from '@/lib/constants/routes'
import { IS_DEMO_MODE } from '@/lib/constants/env'

/**
 * Where a trip row opens. Demo mode pre-renders a page per mock trip (/trips/[id]); a real
 * trip's UUID can't be enumerated at build time under output: 'export', so it rides in a
 * query param on the static /trips/detail page instead.
 */
export function tripDetailHref(tripId: string): string {
  return IS_DEMO_MODE ? ROUTES.tripDetail(tripId) : ROUTES.tripDetailById(tripId)
}
