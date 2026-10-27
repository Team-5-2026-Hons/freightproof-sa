'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ShieldAlert } from 'lucide-react'
import { PHASE_NAMES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useScrolledPastTop } from '@/lib/hooks/useScrolledPastTop'
import { useEdgeBackHandler } from '@/lib/navigation/edge-back'
import { backTarget } from '@/lib/navigation/back-stack'
import { useOptionalTrip } from '@/lib/hooks/useOptionalTrip'

interface StepHeaderProps {
  phase: PhaseDescriptor
  stepIndex: number
}

export function StepHeader({ phase, stepIndex }: StepHeaderProps) {
  const router = useRouter()
  const scrolled = useScrolledPastTop()
  const session = useOptionalTrip()

  const slugs = STEP_SLUGS[phase.phase_type]
  const phaseName = PHASE_NAMES[phase.phase_type]
  const total = slugs.length

  const plan = session?.trip?.phases
    ? [...session.trip.phases].sort((a, b) => a.sequence_number - b.sequence_number).filter((p) => p.phase_type !== 'trip_creation')
    : null
  const position = plan === null ? -1 : plan.findIndex((p) => p.phase_event_id === phase.phase_event_id)
  const counter = [
    position >= 0 && plan !== null ? `Phase ${position + 1} of ${plan.length}` : null,
    total > 1 ? `Step ${stepIndex + 1} of ${total}` : null,
  ].filter(Boolean).join(' · ')

  function handleBack() {
    markTransition('back')
    if (stepIndex > 0) {
      router.push(phaseStepRoute(phase.phase_type, slugs[stepIndex - 1]))
    } else {
      router.push(backTarget(ROUTES.activeTripDetail))
    }
  }
  useEdgeBackHandler(handleBack)

  const backLabel = stepIndex > 0 ? 'Back to previous step' : 'Back'

  return (
    <header
      className={cn(
        'glass-nav sticky top-0 z-sticky border-b px-4 pb-3 pt-safe transition-[border-color] duration-200',
        scrolled ? 'border-hairline' : 'border-transparent',
      )}
    >
      <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label={backLabel}
          className="flex size-11 items-center justify-center rounded-full bg-fill text-surface-on transition-transform duration-100 active:scale-95 active:bg-surface-container-high"
        >
          <ChevronLeft className="size-6 -translate-x-px" strokeWidth={2.25} aria-hidden />
        </button>
        <div className="min-w-0 text-center">
          <h2 className="truncate text-headline text-surface-on">{phaseName}</h2>
          {counter !== '' && <p className="truncate text-footnote tabular-nums text-surface-on-variant">{counter}</p>}
        </div>
        <button
          type="button"
          onClick={() => router.push(ROUTES.panic)}
          aria-label="Emergency: open panic alert"
          className="flex size-11 items-center justify-center rounded-full bg-error-tint text-error transition-transform duration-100 active:scale-95"
        >
          <ShieldAlert className="size-5" strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      {plan !== null && plan.length > 0 && (
        <div data-trip-progress aria-hidden className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${plan.length}, minmax(0, 1fr))` }}>
          {plan.map((p) => {
            const done = p.status === 'completed' || p.status === 'overridden'
            const isThis = p.phase_event_id === phase.phase_event_id
            return (
              <span
                key={p.phase_event_id}
                className={cn('h-1 rounded-full', isThis ? 'bg-secondary' : done ? 'bg-surface-on' : 'bg-surface-container-high')}
              />
            )
          })}
        </div>
      )}
    </header>
  )
}
