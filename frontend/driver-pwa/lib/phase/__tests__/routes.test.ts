import { describe, expect, it } from 'vitest'
import { CROSS_DOCK_PHASE_PLAN, SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { ROUTES } from '@/lib/constants/routes'
import { currentStepRoute, nextStepRoute, phaseStepRoute } from '../routes'

// Marks every phase up to and including `through` (by sequence_number) as completed.
// Local to the test file — see the matching helper in derive.test.ts for why.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

function findByType(plan: readonly PhaseDescriptor[], type: PhaseType): PhaseDescriptor {
  const found = plan.find((p) => p.phase_type === type)
  if (!found) throw new Error(`fixture is missing a phase_type "${type}" row`)
  return found
}

describe('phaseStepRoute', () => {
  it('builds the canonical /trip/phase/{type}/step/{slug} URL', () => {
    expect(phaseStepRoute('unloading', '2-seal-verify')).toBe('/trip/phase/unloading/step/2-seal-verify')
  })
})

describe('currentStepRoute', () => {
  it('returns the first step of the current phase when it has a recipe', () => {
    const activationSeq = findByType(SINGLE_LEG_PHASE_PLAN, 'activation').sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, activationSeq - 1)

    expect(currentStepRoute(plan)).toBe(phaseStepRoute('activation', STEP_SLUGS.activation[0]))
  })

  it('walks past a PENDING in_transit to the arrival step (the mid-leg case)', () => {
    // The exact ledger the driving screen renders against: departure resolved, in_transit
    // still open. The backend keeps it open for the whole drive, so it is currentPhase()
    // — and it has no recipe, so stopping here would leave the driver nowhere to go.
    const departureSeq = findByType(SINGLE_LEG_PHASE_PLAN, 'departure').sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, departureSeq)
    expect(currentStepRoute(plan)).toBe(phaseStepRoute('unloading', STEP_SLUGS.unloading[0]))
  })

  it('lands on leg 2’s unloading, not leg 1’s, on a cross-dock plan', () => {
    // Proves the skip is a sequence_number walk, not a phase_type lookup: leg 1's
    // unloading is already resolved earlier in this same plan.
    const inTransits = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'in_transit')
    expect(inTransits.length).toBeGreaterThan(1)
    const secondInTransit = inTransits[1]
    const plan = walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number - 1)

    const current = plan.find((p) => p.status !== 'completed')!
    expect(current.sequence_number).toBe(secondInTransit.sequence_number)
    expect(currentStepRoute(plan)).toBe(phaseStepRoute('unloading', STEP_SLUGS.unloading[0]))
  })

  it('returns the terminal route once every phase is resolved', () => {
    const lastRow = SINGLE_LEG_PHASE_PLAN[SINGLE_LEG_PHASE_PLAN.length - 1]

    expect(currentStepRoute(walk(SINGLE_LEG_PHASE_PLAN, lastRow.sequence_number))).toBe(ROUTES.trips)
  })
})

describe('nextStepRoute', () => {
  it('advances to the next step within the same phase recipe', () => {
    const unloading = findByType(SINGLE_LEG_PHASE_PLAN, 'unloading')

    const route = nextStepRoute(SINGLE_LEG_PHASE_PLAN, unloading, STEP_SLUGS.unloading[0])

    expect(route).toBe(phaseStepRoute('unloading', STEP_SLUGS.unloading[1]))
  })

  it('advances to the first step of the next unresolved phase at the end of a recipe', () => {
    // Resolve everything through activation; loading (the next phase) is still pending.
    const activationSeq = findByType(SINGLE_LEG_PHASE_PLAN, 'activation').sequence_number
    const plan = walk(SINGLE_LEG_PHASE_PLAN, activationSeq)
    const activation = plan.find((p) => p.sequence_number === activationSeq)!
    const lastSlug = STEP_SLUGS.activation[STEP_SLUGS.activation.length - 1]

    const route = nextStepRoute(plan, activation, lastSlug)

    expect(route).toBe(phaseStepRoute('loading', STEP_SLUGS.loading[0]))
  })

  it('skips a phase whose recipe is empty and lands on the following one that has steps', () => {
    // The real plan generator never emits an empty-recipe phase (trip_creation)
    // anywhere but position 0, so this hand-builds one mid-plan by cloning a real
    // row — proving the walk is driven purely by recipe length, not by which phase
    // type it happens to be skipping over.
    const activation = findByType(SINGLE_LEG_PHASE_PLAN, 'activation')
    const loadingTemplate = findByType(SINGLE_LEG_PHASE_PLAN, 'loading')

    const resolvedActivation: PhaseDescriptor = { ...activation, status: 'completed' }
    const emptyRecipePhase: PhaseDescriptor = {
      ...activation,
      phase_event_id: 'synthetic-empty-recipe' as PhaseDescriptor['phase_event_id'],
      phase_type: 'trip_creation',
      sequence_number: activation.sequence_number + 1,
      step_recipe: [],
      status: 'pending',
    }
    const loading: PhaseDescriptor = {
      ...loadingTemplate,
      sequence_number: activation.sequence_number + 2,
      status: 'pending',
    }
    const plan = [resolvedActivation, emptyRecipePhase, loading]
    const lastSlug = STEP_SLUGS.activation[STEP_SLUGS.activation.length - 1]

    const route = nextStepRoute(plan, resolvedActivation, lastSlug)

    expect(route).toBe(phaseStepRoute('loading', STEP_SLUGS.loading[0]))
  })

  it('advances toward the second unloading in a cross-dock plan without colliding on the first', () => {
    const departures = CROSS_DOCK_PHASE_PLAN.filter((p) => p.phase_type === 'departure')
    expect(departures.length).toBeGreaterThan(1)
    const secondDeparture = departures[1]
    const secondInTransit = CROSS_DOCK_PHASE_PLAN.find(
      (p) => p.phase_type === 'in_transit' && p.sequence_number > secondDeparture.sequence_number,
    )!
    const lastDepartureSlug = STEP_SLUGS.departure[STEP_SLUGS.departure.length - 1]

    // Leg 2's in_transit is still PENDING here, and is walked straight past: its recipe
    // is empty since the GPS-capture step was removed, and firstStepAfter skips any
    // phase with nothing for the driver to do rather than composing a step URL for it.
    // The landing spot is leg 2's unloading — the SECOND one, not the first, which is
    // already resolved earlier in this same plan. That is what proves the walk is a
    // sequence_number walk and not a phase_type lookup.
    expect(STEP_SLUGS.in_transit).toHaveLength(0)
    const midPlan = walk(CROSS_DOCK_PHASE_PLAN, secondDeparture.sequence_number)
    const departureMid = midPlan.find((p) => p.sequence_number === secondDeparture.sequence_number)!
    expect(nextStepRoute(midPlan, departureMid, lastDepartureSlug))
      .toBe(phaseStepRoute('unloading', STEP_SLUGS.unloading[0]))

    // And once leg 2's in_transit is RESOLVED as well, the same completion still lands
    // there — the route must not depend on whether the driverless phase in between has
    // been closed yet.
    const resolvedPlan = walk(CROSS_DOCK_PHASE_PLAN, secondInTransit.sequence_number)
    const departureResolved = resolvedPlan.find((p) => p.sequence_number === secondDeparture.sequence_number)!
    expect(nextStepRoute(resolvedPlan, departureResolved, lastDepartureSlug))
      .toBe(phaseStepRoute('unloading', STEP_SLUGS.unloading[0]))
  })

  it('returns the terminal route once nothing in the plan is unresolved', () => {
    const lastRow = SINGLE_LEG_PHASE_PLAN[SINGLE_LEG_PHASE_PLAN.length - 1]
    const plan = walk(SINGLE_LEG_PHASE_PLAN, lastRow.sequence_number)
    const confirmation = plan.find((p) => p.phase_type === 'confirmation')!
    const lastSlug = STEP_SLUGS.confirmation[STEP_SLUGS.confirmation.length - 1]

    expect(nextStepRoute(plan, confirmation, lastSlug)).toBe(ROUTES.trips)
  })

  it('walks past an already-completed in_transit phase with no special-casing (fence 3)', () => {
    const departure = findByType(SINGLE_LEG_PHASE_PLAN, 'departure')
    const inTransit = findByType(SINGLE_LEG_PHASE_PLAN, 'in_transit')
    // in_transit is auto-completed server-side — simulate that by resolving it even
    // though nothing here walked its own recipe.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, inTransit.sequence_number)
    const departureResolved = plan.find((p) => p.sequence_number === departure.sequence_number)!
    const lastDepartureSlug = STEP_SLUGS.departure[STEP_SLUGS.departure.length - 1]

    const route = nextStepRoute(plan, departureResolved, lastDepartureSlug)

    expect(route).toBe(phaseStepRoute('unloading', STEP_SLUGS.unloading[0]))
  })

  it('throws on an unrecognized step slug instead of silently skipping the phase', () => {
    const activation = findByType(SINGLE_LEG_PHASE_PLAN, 'activation')

    expect(() => nextStepRoute(SINGLE_LEG_PHASE_PLAN, activation, '1-aproach-gate'))
      .toThrow('Unknown step slug "1-aproach-gate" for phase type "activation"')
  })
})
