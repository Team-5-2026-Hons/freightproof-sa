// frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/page.tsx
//
// Server component (no 'use client'): Next.js requires generateStaticParams to be
// exported from a server module, but every driver-pwa page must otherwise be a client
// component (output: 'export' is incompatible with Server Components). This file is the
// minimal server-side wrapper — all rendering logic lives in PhaseStepPageClient.
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseType } from '@shared/lib/types/phase'
import PhaseStepPageClient from './PhaseStepPageClient'

// Static export (output: 'export') requires every dynamic segment to declare its param
// combinations at build time. [type]/[slug] are DERIVED from STEP_SLUGS — never
// hand-written — so a phase type gaining or losing a step automatically follows, the
// same "LENGTH IS DATA" discipline lib/phase/derive.ts insists on everywhere else in
// this refactor. trip_creation's empty recipe naturally contributes zero combinations.
//
// The trip itself, and the specific phase_event_id a URL resolves to, are never in the
// URL at all — see lib/constants/routes.ts's header note on the same constraint for
// trip IDs, and lib/phase/routes.ts's header note on why this route keys on phase_type
// rather than phase_event_id (a server-generated UUID, never statically enumerable).
export function generateStaticParams() {
  return (Object.keys(STEP_SLUGS) as PhaseType[]).flatMap((type) =>
    STEP_SLUGS[type].map((slug) => ({ type, slug })),
  )
}

export default function PhaseStepPage() {
  return <PhaseStepPageClient />
}
