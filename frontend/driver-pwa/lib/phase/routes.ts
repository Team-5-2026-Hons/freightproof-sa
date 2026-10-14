// Step-to-step navigation over a trip's phase plan, for a plan whose length and
// phase-type repetition are DATA rather than a fixed enum.
//
// The URL keys on phase_type, not phase_event_id: output: 'export' needs every dynamic
// route segment enumerable at build time, and a server-generated phase_event_id never
// is. Because a phase_type can recur on a cross-dock plan, this route shape alone can't
// tell two occurrences apart — that disambiguation is the caller's job (TripContext),
// not this module's.

import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { ROUTES } from '@/lib/constants/routes'
import { actionablePhase, currentPhase } from './derive'

/** The canonical URL for a given phase type's step — the one place a step URL is built. */
export function phaseStepRoute(phaseType: PhaseType, slug: string): string {
  return `/trip/phase/${phaseType}/step/${slug}`
}

// Empty-recipe phases (e.g. trip_creation) have no step to land on, so the search keeps
// walking past them. Reuses currentPhase's own resolved-status walk so this file carries
// no second copy of what "resolved" means. Terminates because each iteration strictly
// advances `afterSequence`, and the plan is finite.
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
 * The step the driver should be on right now: the first slug of the current phase's own
 * recipe, or — when that phase has no recipe — the first step of the next phase that
 * does, otherwise the terminal route. The empty-recipe branch is the normal mid-leg
 * case: `in_transit` has no steps of its own and stays PENDING for the whole drive.
 */
export function currentStepRoute(phases: readonly PhaseDescriptor[]): string {
  const phase = actionablePhase(phases)
  if (phase === null) return ROUTES.trips // No unresolved phase has steps: trip finished.

  return phaseStepRoute(phase.phase_type, STEP_SLUGS[phase.phase_type][0])
}

/**
 * Where the driver goes after finishing `slug` within `phase`: the next slug in this
 * phase's own recipe if there is one, otherwise the first step of the next unresolved
 * phase in the plan (skipping any with an empty recipe), otherwise the terminal route.
 *
 * @throws {Error} if `slug` is not in `phase.phase_type`'s recipe — a stale deep link,
 * bookmark, or typo'd URL. Failing loud here prevents silently routing past a phase.
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
  // no branch on phase.phase_type here — a type-specific branch would be a
  // fixed-plan-shape assumption in disguise.
  return firstStepAfter(phases, phase.sequence_number)
}
