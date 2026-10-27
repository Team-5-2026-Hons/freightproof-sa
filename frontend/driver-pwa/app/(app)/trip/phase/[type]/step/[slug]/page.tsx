// Server component: generateStaticParams must run server-side, but driver-pwa otherwise
// requires 'use client' everywhere (output: 'export'). Rendering lives in PhaseStepPageClient.
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseType } from '@shared/lib/types/phase'
import PhaseStepPageClient from './PhaseStepPageClient'

export function generateStaticParams() {
  return (Object.keys(STEP_SLUGS) as PhaseType[]).flatMap((type) =>
    STEP_SLUGS[type].map((slug) => ({ type, slug })),
  )
}

export default function PhaseStepPage() {
  return <PhaseStepPageClient />
}
