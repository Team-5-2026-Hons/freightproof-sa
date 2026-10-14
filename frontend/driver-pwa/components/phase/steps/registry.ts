// Typed map from phase_type -> step slug -> capture component, avoiding an 18-branch switch.
// Step components have no shared prop shape, so `ComponentType<never>` holds them without
// `any` — actual props stay checked at each component's own call site.
//
// Each phase's key set is a literal union mirroring STEP_SLUGS in phase-meta.ts, so removing
// a slug's component here is a compile error. A slug ADDED to STEP_SLUGS can't be detected
// at compile time (phase-meta.ts's array is widened); __tests__/registry.test.ts checks that.

import type { ComponentType } from 'react'
import type { PhaseType } from '@shared/lib/types/phase'

import { Verification } from './activation/Verification'
import { Linehaul } from './loading/Linehaul'
import { CaptureSeal } from './departure/CaptureSeal'
import { ConfirmDeparture } from './departure/ConfirmDeparture'
import { SealVerify as ArrivalSealVerify } from './arrival/SealVerify'
import { VisualCount as UnloadingVisualCount } from './unloading/VisualCount'
import { PodPhoto } from './confirmation/PodPhoto'
import { ReceiverHandover } from './confirmation/ReceiverHandover'
import { Reconciliation } from './confirmation/Reconciliation'
import { Closed } from './confirmation/Closed'

type AnyStepComponent = ComponentType<never>

type ActivationSlug = '2-verification'
type LoadingSlug = '1-linehaul'
type DepartureSlug = '2-capture-seal' | '4-departure'
// The seal check moved here from unloading — same slug, new phase (see arrival/SealVerify.tsx).
type ArrivalSlug = '2-seal-verify'
// Slimmed to visual count only; the seal check now lives on `arrival` above.
type UnloadingSlug = '4-visual-count'
type ConfirmationSlug = '1-pod-photo' | '2-receiver-handover' | '3-reconciliation' | '4-closed'

export interface StepRegistry {
  // trip_creation is dispatcher-side, before the driver is ever involved.
  trip_creation: Record<string, never>
  activation: Record<ActivationSlug, AnyStepComponent>
  loading: Record<LoadingSlug, AnyStepComponent>
  departure: Record<DepartureSlug, AnyStepComponent>
  // in_transit is driver-submitted from the in-transit hub's swipe, not a step page.
  in_transit: Record<string, never>
  arrival: Record<ArrivalSlug, AnyStepComponent>
  unloading: Record<UnloadingSlug, AnyStepComponent>
  confirmation: Record<ConfirmationSlug, AnyStepComponent>
}

export const STEP_REGISTRY: StepRegistry = {
  trip_creation: {},
  activation: {
    '2-verification': Verification,
  },
  loading: {
    '1-linehaul': Linehaul,
  },
  departure: {
    '2-capture-seal': CaptureSeal,
    '4-departure': ConfirmDeparture,
  },
  in_transit: {},
  arrival: {
    '2-seal-verify': ArrivalSealVerify,
  },
  unloading: {
    '4-visual-count': UnloadingVisualCount,
  },
  confirmation: {
    '1-pod-photo': PodPhoto,
    '2-receiver-handover': ReceiverHandover,
    '3-reconciliation': Reconciliation,
    '4-closed': Closed,
  },
}

/** Looks up a step component by phase type + slug — the one place this indirection happens. */
export function stepComponentFor(phaseType: PhaseType, slug: string): AnyStepComponent | undefined {
  const forPhase: Record<string, AnyStepComponent> = STEP_REGISTRY[phaseType]
  return forPhase[slug]
}
