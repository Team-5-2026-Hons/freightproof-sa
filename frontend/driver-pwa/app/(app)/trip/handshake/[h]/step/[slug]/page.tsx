// frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/page.tsx
//
// Server component (no 'use client'): Next.js requires generateStaticParams to be
// exported from a server module, but every driver-pwa page must otherwise be a client
// component (output: 'export' is incompatible with Server Components). This file is the
// minimal server-side wrapper — all rendering logic lives in HandshakeStepPageClient.
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import HandshakeStepPageClient from './HandshakeStepPageClient'

// Static export (output: 'export') requires every dynamic segment to declare its param
// combinations at build time. h and slug are a small, fixed, finite set (STEP_SLUGS is
// the single source of truth — never generate a slug that doesn't belong to its
// handshake number), unlike a trip id, so they can be exhaustively enumerated here.
// The trip itself comes from the driver's session (TripContext), not the URL.
export function generateStaticParams() {
  return (Object.keys(STEP_SLUGS) as unknown as (1 | 2 | 3 | 4 | 5)[]).flatMap((h) =>
    STEP_SLUGS[h].map((slug) => ({ h: String(h), slug })),
  )
}

export default function HandshakeStepPage() {
  return <HandshakeStepPageClient />
}
