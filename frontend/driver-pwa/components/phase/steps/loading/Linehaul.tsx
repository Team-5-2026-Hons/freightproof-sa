// frontend/driver-pwa/components/phase/steps/loading/Linehaul.tsx
'use client'

import { useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { WarehouseWaitAction, WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { buildLinehaulPdf } from '@/lib/scan/buildLinehaulPdf'
import { scanLinehaulSheet } from '@/lib/scan/scanLinehaulSheet'
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

  // A retake replaces the scan while the previous PDF may still be building; only the
  // newest capture's PDF may land in the draft.
  const latestCapture = useRef(0)
  // True while the newest capture's PDF is building. The swipe waits for it, so a driver who
  // swipes straight after the scan still submits the PDF; a stale build never clears it.
  const [pdfBuilding, setPdfBuilding] = useState(false)

  // Upload starts the moment the scan exists, not when the driver swipes — the walk
  // between the two is dead time otherwise. Same pattern as departure/CaptureSeal.tsx.
  //
  // This is now the ONLY capture of the linehaul document (as a scan, plus its PDF).
  // departure's '3-waybill' step photographed the same sheet a second time and was removed
  // (2026-08-10), so a failure here is no longer covered by a later duplicate — which is
  // exactly why the data URL is kept as lib/api/phases.ts's submit-time fallback.
  //
  // The PDF is built from the very scan stored as linehaul_photo, and both go up under
  // their own roles; loading anchors both hashes (payload v3). A PDF that fails to build
  // is logged and dropped: the scan image is the evidence, the PDF the readable copy.
  function handleCapture(dataUrl: string) {
    latestCapture.current += 1
    const capture = latestCapture.current
    const capturedAt = new Date().toISOString()
    onUpdate({
      linehaulPhotoDataUrl: dataUrl, linehaulPhotoArtifactId: null,
      linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt,
    })
    void uploadNow(dataUrl, 'photo', capturedAt, 'linehaul_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ linehaulPhotoArtifactId: artifactId })
    })
    setPdfBuilding(true)
    void buildLinehaulPdf(dataUrl)
      .then(async (pdf): Promise<string | null> => {
        if (capture !== latestCapture.current) return null
        onUpdate({ linehaulPdfDataUrl: pdf })
        setPdfBuilding(false)
        return uploadNow(pdf, 'document', capturedAt, 'linehaul_pdf')
      })
      .then((artifactId) => {
        if (artifactId !== null && capture === latestCapture.current) {
          onUpdate({ linehaulPdfArtifactId: artifactId })
        }
      })
      .catch((err: unknown) => {
        if (capture === latestCapture.current) setPdfBuilding(false)
        console.warn('Linehaul PDF could not be built — submitting the scan alone', err)
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
      intro="Compare these with the sheet you were handed, then scan it."
      requirements={[{ label: 'Sheet scan', met: hasPhoto }]}
      action={
        <SwipeToConfirm
          label="Confirm Linehaul"
          waitingLabel={hasPhoto && pdfBuilding ? 'Preparing the PDF…' : 'Scan the sheet first'}
          onConfirm={onComplete}
          disabled={!hasPhoto || pdfBuilding}
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
        actionLabel="Scan the sheet"
        hint="Lay it flat, all four corners in view"
        dataUrl={draft.linehaulPhotoDataUrl}
        onCapture={handleCapture}
        // The phone's document scanner finds the edges and flattens the page; the browser
        // has none, so it keeps the plain camera and the PDF wraps the uncropped photo.
        nativeSource={Capacitor.isNativePlatform() ? scanLinehaulSheet : undefined}
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
