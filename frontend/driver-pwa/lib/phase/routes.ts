// Step-to-step navigation over a trip's phase plan — the driver-pwa analogue of the
// old lib/navigation/handshake-flow.ts, rebuilt for a plan whose length and phase-type
// repetition are DATA rather than a fixed handshake enum.
//
// The URL keys on phase_type, not phase_event_id: output: 'export' (required for the
// Capacitor APK build) needs every dynamic route segment enumerable at build time, and
// a server-generated phase_event_id never is — see lib/constants/routes.ts's own note
// on the same constraint for trip IDs. Because a phase_type can recur on a cross-dock
// plan (more than one `unloading`), this route shape alone can't tell two occurrences
// apart; that disambiguation is the caller's job (TripContext / the active phase from
// derive.ts), not this module's — this module only ever answers "what's the URL for
// this type+slug", never "which occurrence am I looking at".

import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { ROUTES } from '@/lib/constants/routes'
import { currentPhase } from './derive'

/** The canonical URL for a given phase type's step — the one place a step URL is built. */
export function phaseStepRoute(phaseType: PhaseType, slug: string): string {
  return `/trip/phase/${phaseType}/step/${slug}`
}

// Empty-recipe phases (currently only trip_creation) have no step to land on, so the
// search keeps walking past them. Reuses currentPhase's own resolved-status walk on
// the remainder of the plan (everything strictly after `afterSequence`) so this file
// carries no second copy of what "resolved" means, and so a repeated phase_type is
// handled exactly the way currentPhase already proves it handles one: by
// sequence_number, never by type. Terminates because each iteration strictly advances
// `afterSequence` to a real row's sequence_number, and the plan is finite.
function firstStepAfter(phases: readonly PhaseDescriptor[], afterSequence: number): string {
  let cursor = afterSequence
  for (;;) {
    const remaining = phases.filter((phase) => phase.sequence_number > cursor)
    const next = currentPhase(remaining)
    if (next === null) return ROUTES.trips // Nothing left unresolved: trip finished.

    const slugs = STEP_SLUGS[next.phase_type]
    if (slugs.length > 0) return phaseStepRoute(next.phase_type, slugs[0])

    cursor = next.sequence_number
  }
}

/**
 * Where the driver goes after finishing `slug` within `phase`: the next slug in this
 * phase's own recipe if there is one, otherwise the first step of the next unresolved
 * phase in the plan (skipping any with an empty recipe), otherwise the terminal route.
 *
 * @throws {Error} if `slug` is not in `phase.phase_type`'s recipe — a stale deep
 * link, bookmark, or typo'd URL. Failing loud here prevents silently routing the
 * driver past an entire phase (mirrors handshake-flow.ts's own reasoning).
 */
export function nextStepRoute(
  phases: readonly PhaseDescriptor[],
  phase: PhaseDescriptor,
  slug: string,
): string {
  const slugs = STEP_SLUGS[phase.phase_type]
  const stepIndex = slugs.indexOf(slug)

  if (stepIndex === -1) {
    throw new Error(`Unknown step slug "${slug}" for phase type "${phase.phase_type}"`)
  }

  // Mid-phase — next step of the same recipe.
  if (stepIndex < slugs.length - 1) {
    return phaseStepRoute(phase.phase_type, slugs[stepIndex + 1])
  }

  // End of this phase's recipe: walk forward from its position in the plan. Deliberately
  // no branch on phase.phase_type here — e.g. no `if (phase.phase_type === 'in_transit')
  // skip` — because in_transit being auto-completed server-side already shows up as
  // "resolved" by the time the walk reaches it, and the generic rule handles that for
  // free. A type-specific branch here would be a fixed-plan-shape assumption in disguise.
  return firstStepAfter(phases, phase.sequence_number)
}
