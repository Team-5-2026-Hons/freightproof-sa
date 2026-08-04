// frontend/driver-pwa/components/phase/steps/registry.ts
//
// Typed map from phase_type -> step slug -> capture component, so a page client can
// resolve "what do I render for this phase's current step" without an 18-branch switch.
//
// Each step component's real prop shape differs (different evidence draft type per phase,
// some steps omit onUpdate for review-only screens, unloading's SealVerify takes an extra
// referenceSealNumber prop) — there is no single prop shape all sixteen genuinely share,
// and forcing one would mean weakening every individual component's own types just to fit
// the map. `ComponentType<never>` is the standard way to hold heterogeneous component
// types in one map without an `any`: `never` is a subtype of every prop type, so any real
// component is assignable here with zero cast, while each component's ACTUAL props stay
// fully checked wherever it's imported and rendered directly (its own file, its own
// __tests__). A caller pulling a component out of this map is expected to already know
// which phase/slug it asked for and to supply that step's real props at the call site.
//
// Compile-time completeness: each phase's key set below is a hand-written literal union
// mirroring STEP_SLUGS in phase-meta.ts. Record<LiteralUnion, ComponentType<never>>
// requires every key in that union to have an entry, so removing a slug's component here
// (while the union still lists it) is a compile error — the "missing component" case the
// task asks for. It can't run in the other direction: phase-meta.ts's own STEP_SLUGS is
// typed `Record<PhaseType, readonly string[]>`, a widened array with no literal slugs
// preserved for a mapped type to key off of, so this file can't detect a slug ADDED to
// STEP_SLUGS purely at compile time. __tests__/registry.test.ts closes that gap at
// runtime, asserting the two agree exactly in both directions.

import type { ComponentType } from 'react'
import type { PhaseType } from '@shared/lib/types/phase'

import { GateArrival } from './activation/GateArrival'
import { Verification } from './activation/Verification'
import { VisualCount as LoadingVisualCount } from './loading/VisualCount'
import { ApproachExit } from './departure/ApproachExit'
import { CaptureSeal } from './departure/CaptureSeal'
import { Waybill } from './departure/Waybill'
import { ConfirmDeparture } from './departure/ConfirmDeparture'
import { Arrival } from './in_transit/Arrival'
import { HandWaybill } from './unloading/HandWaybill'
import { SealVerify } from './unloading/SealVerify'
import { SealBreakInspection } from './unloading/SealBreakInspection'
import { VisualCount as UnloadingVisualCount } from './unloading/VisualCount'
import { PodPhoto } from './confirmation/PodPhoto'
import { PodSignature } from './confirmation/PodSignature'
import { Reconciliation } from './confirmation/Reconciliation'
import { Closed } from './confirmation/Closed'

// `never`, not `any` — see file header for why this is the correct bottom type here.
type AnyStepComponent = ComponentType<never>

type ActivationSlug = '1-approach-gate' | '2-verification'
type LoadingSlug = '1-visual-count'
type DepartureSlug = '1-approach-exit' | '2-capture-seal' | '3-waybill' | '4-departure'
type InTransitSlug = '1-arrival'
type UnloadingSlug = '1-hand-waybill' | '2-seal-verify' | '3-seal-break-inspection' | '4-visual-count'
type ConfirmationSlug = '1-pod-photo' | '2-pod-signature' | '3-reconciliation' | '4-closed'

export interface StepRegistry {
  // Empty recipe — trip_creation is dispatcher-side, before the driver is ever involved.
  trip_creation: Record<string, never>
  activation: Record<ActivationSlug, AnyStepComponent>
  loading: Record<LoadingSlug, AnyStepComponent>
  departure: Record<DepartureSlug, AnyStepComponent>
  in_transit: Record<InTransitSlug, AnyStepComponent>
  unloading: Record<UnloadingSlug, AnyStepComponent>
  confirmation: Record<ConfirmationSlug, AnyStepComponent>
}

export const STEP_REGISTRY: StepRegistry = {
  trip_creation: {},
  activation: {
    '1-approach-gate': GateArrival,
    '2-verification': Verification,
  },
  loading: {
    '1-visual-count': LoadingVisualCount,
  },
  departure: {
    '1-approach-exit': ApproachExit,
    '2-capture-seal': CaptureSeal,
    '3-waybill': Waybill,
    '4-departure': ConfirmDeparture,
  },
  in_transit: {
    '1-arrival': Arrival,
  },
  unloading: {
    '1-hand-waybill': HandWaybill,
    '2-seal-verify': SealVerify,
    '3-seal-break-inspection': SealBreakInspection,
    '4-visual-count': UnloadingVisualCount,
  },
  confirmation: {
    '1-pod-photo': PodPhoto,
    '2-pod-signature': PodSignature,
    '3-reconciliation': Reconciliation,
    '4-closed': Closed,
  },
}

/** Looks up a step component by phase type + slug — the one place this indirection happens. */
export function stepComponentFor(phaseType: PhaseType, slug: string): AnyStepComponent | undefined {
  const forPhase: Record<string, AnyStepComponent> = STEP_REGISTRY[phaseType]
  return forPhase[slug]
}
