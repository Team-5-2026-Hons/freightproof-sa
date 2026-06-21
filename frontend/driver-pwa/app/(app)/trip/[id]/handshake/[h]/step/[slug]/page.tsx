// frontend/driver-pwa/app/(app)/trip/[id]/handshake/[h]/step/[slug]/page.tsx
'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useHandshakeDraft } from '@/lib/hooks/useHandshakeDraft'
import { submitHandshake } from '@/lib/api/handshakes'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { nextHandshakeRoute } from '@/lib/navigation/handshake-flow'
import type { H1Evidence, H2Evidence, H3Evidence, H4Evidence, H5Evidence } from '@/lib/types/evidence-draft'
import { H1GateArrival } from '@/components/handshake/steps/H1GateArrival'
import { H1EntryPhoto } from '@/components/handshake/steps/H1EntryPhoto'
import { H1Verification } from '@/components/handshake/steps/H1Verification'
import { H2ArriveBay } from '@/components/handshake/steps/H2ArriveBay'
import { H2Manifest } from '@/components/handshake/steps/H2Manifest'
import { H2Waybill } from '@/components/handshake/steps/H2Waybill'
import { H2Seal } from '@/components/handshake/steps/H2Seal'
import { H2Review } from '@/components/handshake/steps/H2Review'
import { H3ApproachExit } from '@/components/handshake/steps/H3ApproachExit'
import { H3ExitSeal } from '@/components/handshake/steps/H3ExitSeal'
import { H3Departure } from '@/components/handshake/steps/H3Departure'
import { H4ApproachDest } from '@/components/handshake/steps/H4ApproachDest'
import { H4EntryPhoto } from '@/components/handshake/steps/H4EntryPhoto'
import { H4SealVerify } from '@/components/handshake/steps/H4SealVerify'
import { H5HandWaybill } from '@/components/handshake/steps/H5HandWaybill'
import { H5SealInspection } from '@/components/handshake/steps/H5SealInspection'
import { H5VisualCount } from '@/components/handshake/steps/H5VisualCount'
import { H5PodPhoto } from '@/components/handshake/steps/H5PodPhoto'
import { H5Reconciliation } from '@/components/handshake/steps/H5Reconciliation'
import { H5Closed } from '@/components/handshake/steps/H5Closed'

// gateAddress is a required field on H1Evidence (reverse-geocoded display value, display-only) —
// must be present here or this literal fails to satisfy H1Evidence.
const H1_INITIAL: H1Evidence = { gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, gateAddress: null, capturedAt: null }
const H2_INITIAL: H2Evidence = { gpsLat: null, gpsLng: null, ppManifestParcelCount: null, driverVisualCount: null, waybillPhotoDataUrl: null, sealNumber: null, sealPhotoDataUrl: null, capturedAt: null }
const H3_INITIAL: H3Evidence = { gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, sealNumberConfirmed: null, sealVerifiedMatch: null, capturedAt: null }
const H4_INITIAL: H4Evidence = { gpsLat: null, gpsLng: null, gatePhotoDataUrl: null, sealVerifiedMatch: null, capturedAt: null }
const H5_INITIAL: H5Evidence = { waybillHandedOver: null, sealBrokenPhotoDataUrl: null, driverVisualCount: null, podPhotoDataUrl: null, reconciliationNote: null, capturedAt: null }

export default function HandshakeStepPage() {
  const { id: tripId, h, slug } = useParams<{ id: string; h: string; slug: string }>()
  const router = useRouter()
  const { enqueue } = useOfflineQueue()

  const handshakeNum = Number(h) as 1 | 2 | 3 | 4 | 5

  // URL-derived navigation (single source of truth) — see lib/navigation/handshake-flow.ts.
  // The backend stays authoritative for whether the handshake is valid; this only moves
  // the driver to the next screen. Driving flow from the URL (not TripContext's internal
  // counter) means a refresh or deep-link can never land on the wrong step.
  const advance = useCallback(
    () => router.push(nextHandshakeRoute(tripId, handshakeNum, slug)),
    [router, tripId, handshakeNum, slug],
  )

  const [h1Draft, updateH1, clearH1] = useHandshakeDraft<H1Evidence>(tripId, 'origin_gate_in', H1_INITIAL)
  const [h2Draft, updateH2, clearH2] = useHandshakeDraft<H2Evidence>(tripId, 'loading', H2_INITIAL)
  const [h3Draft, updateH3, clearH3] = useHandshakeDraft<H3Evidence>(tripId, 'origin_gate_out', H3_INITIAL)
  const [h4Draft, updateH4, clearH4] = useHandshakeDraft<H4Evidence>(tripId, 'dest_gate_in', H4_INITIAL)
  const [h5Draft, updateH5, clearH5] = useHandshakeDraft<H5Evidence>(tripId, 'unloading', H5_INITIAL)

  async function submitAndAdvance(
    type: 'origin_gate_in' | 'loading' | 'origin_gate_out' | 'dest_gate_in' | 'unloading',
    evidence: H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence,
    clearFn: () => void,
  ) {
    try {
      await submitHandshake(tripId, type, evidence)
    } catch {
      // TODO(backend-integration): submitHandshake failures are treated uniformly here —
      // a terminal/validation failure (will never succeed) is queued and the draft is
      // cleared identically to a transient network failure. See the matching TODO in
      // useOfflineQueue.ts's flush(). Don't fix until submitHandshake can report which
      // kind of failure occurred.
      enqueue(tripId, type, evidence)
    }
    clearFn()
    advance()
  }

  const props = { tripId }

  if (handshakeNum === 1) {
    if (slug === '1-approach-gate') return <H1GateArrival {...props} draft={h1Draft} onUpdate={updateH1} onComplete={advance} />
    if (slug === '2-entry-photo')   return <H1EntryPhoto  {...props} draft={h1Draft} onUpdate={updateH1} onComplete={advance} />
    if (slug === '3-verification')  return <H1Verification {...props} draft={h1Draft} onComplete={() => submitAndAdvance('origin_gate_in', h1Draft, clearH1)} />
  }

  if (handshakeNum === 2) {
    if (slug === '1-arrive-bay') return <H2ArriveBay {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '2-manifest')   return <H2Manifest  {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '3-waybill')    return <H2Waybill   {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '4-seal')       return <H2Seal      {...props} draft={h2Draft} onUpdate={updateH2} onComplete={advance} />
    if (slug === '5-review')     return <H2Review    {...props} draft={h2Draft} onComplete={() => submitAndAdvance('loading', h2Draft, clearH2)} />
  }

  if (handshakeNum === 3) {
    if (slug === '1-approach-exit')  return <H3ApproachExit {...props} draft={h3Draft} onUpdate={updateH3} onComplete={advance} />
    if (slug === '2-exit-and-seal')  return <H3ExitSeal     {...props} draft={h3Draft} h2SealNumber={h2Draft.sealNumber} onUpdate={updateH3} onComplete={advance} />
    if (slug === '3-departure')      return <H3Departure    {...props} draft={h3Draft} onComplete={() => submitAndAdvance('origin_gate_out', h3Draft, clearH3)} />
  }

  if (handshakeNum === 4) {
    if (slug === '1-approach-dest')    return <H4ApproachDest {...props} draft={h4Draft} onUpdate={updateH4} onComplete={advance} />
    if (slug === '2-dest-entry-photo') return <H4EntryPhoto   {...props} draft={h4Draft} onUpdate={updateH4} onComplete={advance} />
    if (slug === '3-seal-verify')      return <H4SealVerify   {...props} draft={h4Draft} h2SealNumber={h2Draft.sealNumber} onUpdate={updateH4} onComplete={() => submitAndAdvance('dest_gate_in', h4Draft, clearH4)} />
  }

  if (handshakeNum === 5) {
    if (slug === '1-hand-waybill')        return <H5HandWaybill    {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '2-seal-break-inspection') return <H5SealInspection {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '3-visual-count')        return <H5VisualCount    {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} h2Count={h2Draft.driverVisualCount} />
    if (slug === '4-pod-photo')           return <H5PodPhoto       {...props} onComplete={advance} />
    if (slug === '5-reconciliation')      return <H5Reconciliation {...props} draft={h5Draft} onUpdate={updateH5} onComplete={advance} />
    if (slug === '6-closed')              return <H5Closed         {...props} draft={h5Draft} onComplete={() => submitAndAdvance('unloading', h5Draft, clearH5)} />
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-error">Unknown step: H{handshakeNum}/{slug}</p>
    </main>
  )
}
