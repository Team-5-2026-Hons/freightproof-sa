'use client'

import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { WarehouseWaitAction, WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { isPhaseBlocked } from '@/lib/phase'
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

export function Linehaul({
  tripId, phase, stepIndex, linehaul, draft, onUpdate, onComplete,
}: LinehaulProps) {
  const isBlocked = isPhaseBlocked(phase)

  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)

  const latestCapture = useRef(0)
  const [pdfBuilding, setPdfBuilding] = useState(false)

  const pdfStartedFor = useRef<string | null>(null)

  function buildPdf(dataUrl: string, capturedAt: string) {
    latestCapture.current += 1
    const capture = latestCapture.current
    pdfStartedFor.current = dataUrl
    setPdfBuilding(true)
    void import('@/lib/scan/buildLinehaulPdf')
      .then(({ buildLinehaulPdf }) => buildLinehaulPdf(dataUrl))
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

  function handleCapture(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({
      linehaulPhotoDataUrl: dataUrl, linehaulPhotoArtifactId: null,
      linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt,
    })
    void uploadNow(dataUrl, 'photo', capturedAt, 'linehaul_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ linehaulPhotoArtifactId: artifactId })
    })
    buildPdf(dataUrl, capturedAt)
  }

  const photoDataUrl = draft.linehaulPhotoDataUrl
  const pdfMissing = photoDataUrl !== null && !draft.linehaulPdfDataUrl && !draft.linehaulPdfArtifactId
  const draftCapturedAt = draft.capturedAt
  useEffect(() => {
    if (!pdfMissing || photoDataUrl === null || pdfStartedFor.current === photoDataUrl) return
    buildPdf(photoDataUrl, draftCapturedAt ?? new Date().toISOString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfMissing, photoDataUrl, draftCapturedAt])

  const hasPhoto = Boolean(draft.linehaulPhotoDataUrl)

  if (isBlocked) {
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
        busy={pdfBuilding}
        busyLabel="Preparing the PDF"
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
