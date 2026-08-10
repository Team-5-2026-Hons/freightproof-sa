// frontend/driver-pwa/components/phase/steps/__tests__/registry.test.ts
//
// STEP_REGISTRY's key sets are hand-written literal unions (registry.ts's header comment
// explains why STEP_SLUGS's own type — Record<PhaseType, readonly string[]> — can't drive
// a mapped type). This test is the runtime half of that guarantee: it asserts the
// registry and the shared STEP_SLUGS source of truth agree on every phase type, in BOTH
// directions, so a slug added to STEP_SLUGS but never given a component here (a case a
// compile error can't catch) fails a test instead of shipping a silent dead route.
import { describe, it, expect } from 'vitest'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseType } from '@shared/lib/types/phase'
import { STEP_REGISTRY, stepComponentFor } from '../registry'

const PHASE_TYPES = Object.keys(STEP_SLUGS) as PhaseType[]

describe('STEP_REGISTRY', () => {
  it.each(PHASE_TYPES)('has exactly the slugs STEP_SLUGS declares for "%s"', (phaseType) => {
    const expectedSlugs = [...STEP_SLUGS[phaseType]].sort()
    const registeredSlugs = Object.keys(STEP_REGISTRY[phaseType]).sort()

    expect(registeredSlugs).toEqual(expectedSlugs)
  })

  it('resolves a known phase/slug pair to a component', () => {
    expect(stepComponentFor('activation', '2-verification')).toBeDefined()
    expect(stepComponentFor('confirmation', '4-closed')).toBeDefined()
  })

  it('returns undefined for an unknown slug', () => {
    expect(stepComponentFor('activation', 'not-a-real-slug')).toBeUndefined()
  })

  it('trip_creation has no steps — no driver interaction before activation', () => {
    expect(Object.keys(STEP_REGISTRY.trip_creation)).toHaveLength(0)
    expect(STEP_SLUGS.trip_creation).toHaveLength(0)
  })
})
