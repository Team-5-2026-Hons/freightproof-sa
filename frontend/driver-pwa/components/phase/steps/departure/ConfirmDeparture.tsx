'use client'

import { useRouter } from 'next/navigation'
import { Camera, Lock, MapPinned } from 'lucide-react'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import { StepLayout } from '@/components/phase/StepLayout'
import { ReviewRow } from '@/components/phase/ReviewRow'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { phaseStepRoute } from '@/lib/phase'
import { useOptionalTrip } from '@/lib/hooks/useOptionalTrip'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { markTransition } from '@/lib/navigation/transition-direction'
import { formatTime } from '@/lib/utils/format-time'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface ConfirmDepartureProps {
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onComplete: () => void | Promise<void>
}

const ICON = 'size-6'

function HeadingTo({ trip }: { trip: Trip }) {
  const { destination } = useTripPlaces(trip)
  const due = trip.planned_arrival_at === null ? null : `due ${formatTime(trip.planned_arrival_at)}`
  return (
    <ReviewRow
      icon={<MapPinned className={ICON} strokeWidth={1.8} />}
      label="Heading to"
      value={[destination.name, due].filter(Boolean).join(' · ')}
    />
  )
}

export function ConfirmDeparture({ phase, stepIndex, draft, onComplete }: ConfirmDepartureProps) {
  const router = useRouter()
  const trip = useOptionalTrip()?.trip ?? null

  const isReady = draft.sealNumber !== null && draft.sealPhotoDataUrl !== null

  function backToCapture() {
    markTransition('back')
    router.push(phaseStepRoute(phase.phase_type, STEP_SLUGS[phase.phase_type][0]))
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Check the seal one last time. When you swipe Depart, you’re in transit."
      requirements={[
        { label: 'Seal number', met: draft.sealNumber !== null },
        { label: 'Seal photo', met: draft.sealPhotoDataUrl !== null },
      ]}
      action={
        <SwipeToConfirm
          label="Swipe to Depart"
          waitingLabel="Add number and photo"
          committedLabel="Departed"
          committedHint="Opening In Transit…"
          onConfirm={onComplete}
          disabled={!isReady}
        />
      }
    >
      <div className="divide-y divide-hairline">
        <ReviewRow
          icon={<Lock className={ICON} strokeWidth={1.8} />}
          label="Seal number"
          value={<span className="text-title-3 tracking-wide">{draft.sealNumber ?? '—'}</span>}
          action={{ label: 'Edit', onClick: backToCapture, accessibleName: 'Edit seal number' }}
        />
        <ReviewRow
          icon={<Camera className={ICON} strokeWidth={1.8} />}
          label="Seal photo"
          media={draft.sealPhotoDataUrl !== null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.sealPhotoDataUrl} alt="Seal photo" className="h-12 w-16 shrink-0 rounded-[10px] object-cover" />
          )}
          value={draft.sealPhotoDataUrl === null
            ? 'Not taken'
            : draft.capturedAt === null ? 'Captured' : `Captured ${formatTime(draft.capturedAt)}`}
          action={{ label: 'Retake', onClick: backToCapture, accessibleName: 'Retake seal photo' }}
        />
        {trip !== null && <HeadingTo trip={trip} />}
      </div>
    </StepLayout>
  )
}
