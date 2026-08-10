// frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Linehaul as LinehaulDocument } from '@shared/lib/types/manifest'
import type { LoadingEvidence } from '@/lib/types/evidence-draft'

interface LinehaulProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  linehaul: LinehaulDocument | null
  draft: LoadingEvidence
  onUpdate: (patch: Partial<LoadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

// Replaces loading/VisualCount.tsx. The driver never enters the warehouse, so he cannot
// honestly count what was loaded; what he IS given is the linehaul sheet — the driver-safe
// summary (vehicle, driver, consolidated unit count, no contents). This step restores
// H2Linehaul.tsx, deleted in 493b9fe, and reconnects manifest_service.get_linehaul_for_driver,
// which has had no driver-side consumer since.
//
// NEVER render per-parcel data here. LinehaulResponse is deliberately narrow (its docstring
// enforces the theft-risk rule); widening what this screen shows would defeat the reason the
// endpoint is separate from the dispatcher's manifest in the first place.
export function Linehaul({
  tripId, phase, stepIndex, linehaul, draft, onUpdate, onComplete,
}: LinehaulProps) {
  // The server is the authority — it 409s a blocked completion regardless of what this
  // renders. This is the courteous half: tell the driver why nothing is actionable rather
  // than showing him a control that will fail.
  //
  // `blocked_on` is optional on the shared PhaseDescriptor type (not yet guaranteed by
  // every fixture) — `phase.blocked_on !== null` would read `undefined !== null` and be
  // permanently true, so the field is coalesced to null first.
  const isBlocked = (phase.blocked_on ?? null) !== null

  const { uploadNow } = useArtifactUpload(tripId)

  // Upload starts the moment the photo exists, not when the driver swipes — the walk
  // between the two is dead time otherwise. Same pattern as departure/CaptureSeal.tsx.
  //
  // This is now the ONLY capture of the linehaul document. departure's '3-waybill' step
  // photographed the same sheet a second time and was removed (2026-08-10), so a failure
  // here is no longer covered by a later duplicate — which is exactly why the data URL is
  // kept as lib/api/phases.ts's submit-time fallback.
  function handleCapture(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ linehaulPhotoDataUrl: dataUrl, linehaulPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ linehaulPhotoArtifactId: artifactId })
    })
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {isBlocked ? (
          <WarehouseWaitCard>
            Loading is still in progress. This will unlock on its own once the warehouse
            finishes. No action is needed from you.
          </WarehouseWaitCard>
        ) : (
          <>
            <p className="text-sm text-surface-on-variant">
              Check this against the linehaul sheet you were given, then confirm.
            </p>
            <dl className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">
              <Row label="Vehicle" value={linehaul?.vehicle_registration ?? '—'} />
              <Row label="Type" value={linehaul?.vehicle_type ?? '—'} />
              <Row label="Driver" value={linehaul?.driver_full_name ?? '—'} />
              <Row label="Units on board" value={String(linehaul?.consolidated_unit_count ?? '—')} />
            </dl>
            <CameraCapture
              label="Linehaul sheet"
              dataUrl={draft.linehaulPhotoDataUrl}
              onCapture={handleCapture}
            />
          </>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        {!isBlocked && (
          <SwipeToConfirm
            label="Confirm linehaul"
            onConfirm={onComplete}
            disabled={!draft.linehaulPhotoDataUrl}
          />
        )}
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3">
      <dt className="text-sm text-surface-on-variant">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  )
}
