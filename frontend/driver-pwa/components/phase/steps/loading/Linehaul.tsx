// frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx
'use client'

import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { WarehouseWaitAction, WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
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

  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)

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
    void uploadNow(dataUrl, 'photo', capturedAt, 'linehaul_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ linehaulPhotoArtifactId: artifactId })
    })
  }

  const hasPhoto = Boolean(draft.linehaulPhotoDataUrl)

  if (isBlocked) {
    // No swipe while blocked: the server would 409 it, so there is nothing to offer.
    return (
      <StepLayout phase={phase} stepIndex={stepIndex} showTitle={false} action={<WarehouseWaitAction />}>
        <WarehouseWaitCard title="Loading in progress">
          The warehouse is still loading your truck. This step will unlock on its own when
          they finish. Nothing to do yet.
        </WarehouseWaitCard>
      </StepLayout>
    )
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Compare these with the sheet you were handed, then photograph it."
      requirements={[{ label: 'Sheet photo', met: hasPhoto }]}
      action={
        <SwipeToConfirm
          label="Confirm Linehaul"
          waitingLabel="Add the sheet photo first"
          onConfirm={onComplete}
          disabled={!hasPhoto}
        />
      }
    >
      {/* Grouped rows on a fill, as on the trip page: these are facts to check, not
          controls, so they carry no chevrons and no card shadow. */}
      <dl className="divide-y divide-hairline rounded-[18px] bg-fill px-4">
        <Row label="Vehicle" value={linehaul?.vehicle_registration ?? '—'} />
        <Row label="Type" value={linehaul?.vehicle_type ?? '—'} />
        <Row label="Driver" value={linehaul?.driver_full_name ?? '—'} />
        <Row label="Units on board" value={String(linehaul?.consolidated_unit_count ?? '—')} />
      </dl>
      <CameraCapture
        label="Linehaul sheet"
        actionLabel="Photograph the sheet"
        hint="Fill the frame, keep the numbers sharp"
        dataUrl={draft.linehaulPhotoDataUrl}
        onCapture={handleCapture}
      />
    </StepLayout>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 py-2">
      <dt className="text-body text-surface-on-variant">{label}</dt>
      <dd className="text-right text-body font-semibold tabular-nums text-surface-on">{value}</dd>
    </div>
  )
}
