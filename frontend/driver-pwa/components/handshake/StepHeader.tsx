'use client'

import { useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'

interface StepHeaderProps {
  tripId: string
  handshakeName: string
  stepName: string
  stepIndex: number   // 1-based
  totalSteps: number
}

export function StepHeader({ tripId, handshakeName, stepName, stepIndex, totalSteps }: StepHeaderProps) {
  const router = useRouter()
  const progress = (stepIndex / totalSteps) * 100

  return (
    <header className="sticky top-0 z-sticky bg-surface pb-3 pt-4 px-4 shadow-ambient-header">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => router.push(ROUTES.tripDetail(tripId))}
          className="text-sm text-secondary"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-surface-on-variant truncate">{handshakeName}</p>
          <p className="text-base font-semibold leading-tight truncate">{stepName}</p>
        </div>
        <span className="text-xs text-surface-on-variant tabular-nums">
          {stepIndex}/{totalSteps}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
        <div
          className="h-full rounded-full bg-secondary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  )
}
