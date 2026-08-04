'use client'

import { useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PHASE_NAMES, STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { IconButton } from '@/components/ui/IconButton'

interface StepHeaderProps {
  phase: PhaseDescriptor
  // 0-based — matches PhaseStep.stepIndex from lib/phase/derive.ts's stepsFor(), and
  // indexes directly into STEP_NAMES[phase.phase_type]/STEP_SLUGS[phase.phase_type].
  stepIndex: number
}

export function StepHeader({ phase, stepIndex }: StepHeaderProps) {
  const router = useRouter()

  // Derived straight from phase-meta rather than a hook (the old useStepIndicator has no
  // equivalent here): a phase_type can occur more than once in one trip's plan, so
  // "current/total" must come from THIS phase occurrence's own recipe, never from a
  // lookup keyed only on type — the recipe itself is the same either way, but the
  // component must not reintroduce a shared-lookup shape that assumes one row per type.
  const slugs = STEP_SLUGS[phase.phase_type]
  const stepName = STEP_NAMES[phase.phase_type][stepIndex] ?? ''
  const phaseName = PHASE_NAMES[phase.phase_type]
  const current = stepIndex + 1
  const total = slugs.length
  const progress = total > 0 ? (current / total) * 100 : 0

  // Mid-phase (not the first step): back goes to the previous step of the SAME phase
  // occurrence, not out of it entirely. Drafts persist in localStorage keyed on
  // phase_event_id (usePhaseDraft), so stepping back and forward again is always safe —
  // including for a repeated phase_type, since that key never collides across occurrences.
  function handleBack() {
    if (stepIndex > 0) {
      router.push(phaseStepRoute(phase.phase_type, slugs[stepIndex - 1]))
    } else {
      router.push(ROUTES.activeTripDetail)
    }
  }

  const backLabel = stepIndex > 0 ? 'Back to previous step' : 'Back to trip'

  return (
    // pt-safe clears the iOS status bar — phase steps are full-bleed
    // (lib/navigation/full-bleed.ts), so this header owns the top of the device and
    // would otherwise put the back arrow and panic button behind the notch. The 1rem
    // that used to be pt-4 moves onto the inner row (see SubpageHeader for the same
    // split, and why two padding-top utilities must not land on one node).
    // border-b hairline rather than shadow-ambient-header, matching SubpageHeader — see
    // that file for why the blurred shadow had to go. Kept identical here so the two
    // sticky headers a driver moves between mid-trip don't change character.
    <header className="sticky top-0 z-sticky border-b border-outline-variant/25 bg-surface pb-3 pt-safe px-4">
      <div className="mb-3 flex items-center gap-3 pt-4">
        {/* -ml-3 keeps the arrow visually aligned with the header edge while the
            h-11/w-11 box meets the same 44px touch minimum as the panic button. */}
        <button
          onClick={handleBack}
          aria-label={backLabel}
          className="-ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm text-secondary transition-colors hover:bg-secondary/10 active:scale-95"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-surface-on-variant truncate">{phaseName}</p>
          <p className="text-base font-semibold leading-tight truncate">{stepName}</p>
        </div>
        <span className="text-xs text-surface-on-variant tabular-nums">
          {current}/{total}
        </span>
        {/* A driver under threat mid-phase (gate, loading bay) must reach panic without
            first backing out to the trip hub. IconButton (size="md" = 44px, the minimum
            touch target for a stressed, gloved hand): its cn() uses tailwind-merge, which
            resolves the text-error/hover:bg-error-container override against IconButton's
            own default text/hover classes correctly, so there's no risk of the default
            color winning instead. */}
        <IconButton
          icon={<ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.panic)}
          aria-label="Emergency — open panic alert"
          className="text-error hover:bg-error-container/40"
        />
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
