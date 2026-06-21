// frontend/driver-pwa/app/(app)/trip/[id]/handshake/[h]/step/[slug]/page.tsx
//
// Server component (no 'use client'): Next.js requires generateStaticParams to be
// exported from a server module, but every driver-pwa page must otherwise be a client
// component (output: 'export' is incompatible with Server Components). This file is the
// minimal server-side wrapper — all rendering logic lives in HandshakeStepPageClient.
import { mockTrips } from '@shared/lib/mocks/trips'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import HandshakeStepPageClient from './HandshakeStepPageClient'

// Static export (output: 'export') requires every dynamic segment to declare its param
// combinations at build time. This route has three params, so we need the cross-product
// of trip id × handshake number × every slug that's actually valid for that handshake
// (STEP_SLUGS is the single source of truth — never generate a slug that doesn't belong
// to its handshake number). Trip data is mock-only for now — swap for a real fetch once
// Iter 2 lands.
export function generateStaticParams() {
  return mockTrips.flatMap((trip) =>
    (Object.keys(STEP_SLUGS) as unknown as (1 | 2 | 3 | 4 | 5)[]).flatMap((h) =>
      STEP_SLUGS[h].map((slug) => ({ id: String(trip.id), h: String(h), slug })),
    ),
  )
}

export default function HandshakeStepPage() {
  return <HandshakeStepPageClient />
}
