'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useToast } from '@/lib/hooks/useToast'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/TextArea'
import { Switch } from '@/components/ui/Switch'
import { RequirementChecklist } from '@/components/phase/StepLayout'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'
import { submitCheckpoint, type CheckpointEvidence } from '@/lib/api/checkpoints'
import { contextPhaseEventId } from '@/lib/phase/derive'
import { captureCustody } from '@/lib/session/custody-context'
import { classifyLiveWriteFailure, isCustodyConflict } from '@/lib/offline/live-write-conflict'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useBack } from '@/lib/navigation/useBack'
import { cn } from '@/lib/utils'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'

export default function CheckpointPageClient() {
  const router = useRouter()
  const goBack = useBack(ROUTES.inTransit)
  const largeText = useAccessibilityTextSize()
  const { trip } = useTrip()
  const { notify } = useToast()
  const { enqueueCheckpoint } = useOfflineQueue()
  const { capturePosition } = useLocationTrail()
  const [cargoPhotoDataUrl, setCargoPhotoDataUrl] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [isDeviation, setIsDeviation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const clientReportIdRef = useRef<string | null>(null)

  const isReady = cargoPhotoDataUrl !== null

  async function handleSubmit() {
    if (!isReady || !trip) return
    setSubmitting(true)
    setSubmitError(false)
    setStorageError(false)
    const custody = captureCustody(String(trip.id))

    const position = await capturePosition()
    const clientReportId = clientReportIdRef.current ?? crypto.randomUUID()
    clientReportIdRef.current = clientReportId
    const evidence: CheckpointEvidence = {
      gpsLat: position?.lat ?? null,
      gpsLng: position?.lng ?? null,
      cargoPhotoDataUrl: cargoPhotoDataUrl!,
      note: note.trim(),
      isDeviation,
      capturedAt: new Date().toISOString(),
      clientReportId,
      accuracyM: position?.accuracyM ?? null,
      phaseEventId: contextPhaseEventId(trip.phases) ?? undefined,
      custodySequence: custody.custodySequence,
    }

    try {
      await submitCheckpoint(String(trip.id), evidence)
      router.push(ROUTES.inTransit)
    } catch (err) {
      const isRetryable = !(err instanceof ApiError) || err.status >= 500
      if (isRetryable) {
        console.error('Failed to log checkpoint — queued for retry', err)
        if (!enqueueCheckpoint(String(trip.id), evidence)) {
          setStorageError(true)
          return
        }
        notify({
          kind: 'success',
          title: 'Checkpoint recorded',
          body: 'Saved. Evidence stored on this device.',
        })
        router.push(ROUTES.inTransit)
      } else {
        const failure = classifyLiveWriteFailure(err)
        if (failure.kind === 'retain' && isCustodyConflict(failure.attention)) {
          if (!enqueueCheckpoint(String(trip.id), evidence, failure.attention)) {
            setStorageError(true)
            return
          }
          notify({ kind: 'error', title: 'Checkpoint not recorded on the trip', body: failure.attention.reason })
          router.push(ROUTES.home)
          return
        }
        console.error('Failed to log checkpoint', err)
        setSubmitError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!trip) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
          <TriangleAlert className="h-10 w-10" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold">Unable to verify trip</h1>
          <p className="text-lg leading-relaxed opacity-90">
            We could not confirm this checkpoint against your active trip.
            Go back to In Transit and try again.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => { markTransition('back'); router.replace(ROUTES.inTransit) }}>
          Back to In Transit
        </Button>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <SubpageHeader
        title="Checkpoint"
        backLabel="In Transit"
        titleVariant="bar"
        onBack={goBack}
      />
      <div className="flex flex-1 flex-col gap-6 px-5 pb-6 pt-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-title-1 tracking-tight text-surface-on">Log a checkpoint</h2>
          <p className="text-body text-surface-on-variant">
            Photograph the cargo to show the load is intact. Where you are is recorded with it.
          </p>
        </div>

        <CameraCapture
          label="Cargo photo"
          actionLabel="Photograph the cargo"
          hint="Open the doors only if it’s safe to"
          dataUrl={cargoPhotoDataUrl}
          onCapture={setCargoPhotoDataUrl}
        />

        <div>
          <div className="flex min-h-[52px] items-center justify-between gap-4 border-b border-hairline pb-1.5">
            <label htmlFor="route-deviation" className="text-body text-surface-on">
              This is a route deviation
            </label>
            <Switch id="route-deviation" checked={isDeviation} onCheckedChange={setIsDeviation} />
          </div>
        </div>

        <TextArea
          label="Note for dispatch (optional)"
          rows={3}
          placeholder="Anything dispatch should know"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {storageError && (
          <p role="alert" className="text-subhead text-error">
            Couldn’t save on this phone. Storage is full or unavailable. Try again.
          </p>
        )}

        {submitError && (
          <p className="text-subhead text-error">
            Could not submit. The checkpoint was not accepted. Review the details or contact your dispatcher.
          </p>
        )}
      </div>

      <footer className={cn('glass-nav border-t border-hairline px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]', !largeText && 'sticky bottom-0 z-sticky')}>
        <RequirementChecklist requirements={[{ label: 'Cargo photo', met: cargoPhotoDataUrl !== null }]} />
        <div className="flex w-full justify-center">
          <SwipeToConfirm
            label={submitting ? 'Submitting…' : 'Swipe to Log Checkpoint'}
            waitingLabel="Add the cargo photo first"
            onConfirm={handleSubmit}
            disabled={!isReady || submitting}
          />
        </div>
      </footer>
    </main>
  )
}
