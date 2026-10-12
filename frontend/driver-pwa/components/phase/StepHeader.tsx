'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ShieldAlert } from 'lucide-react'
import { PHASE_NAMES, STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'
import { markTransition } from '@/lib/navigation/transition-direction'

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

  // Mid-phase (not the first step): back goes to the previous step of the SAME phase
  // occurrence, not out of it entirely. Drafts persist in localStorage keyed on
  // phase_event_id (usePhaseDraft), so stepping back and forward again is always safe —
  // including for a repeated phase_type, since that key never collides across occurrences.
  function handleBack() {
    markTransition('back')
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
    // sticky headers a driver moves between mid-trip don't change character — both use
    // the shared .glass-nav material, since step content scrolls underneath.
    <header className="glass-nav sticky top-0 z-sticky border-b border-outline-variant/25 pb-3 pt-safe px-4">
      <div className="mb-3 flex items-center gap-3 pt-4">
        {/* Same round ink chevron as SubpageHeader, so the two headers a driver moves
            between mid-trip share one back affordance. 44px, the same touch minimum as
            the panic button opposite it. */}
        <button
          type="button"
          onClick={handleBack}
          aria-label={backLabel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-surface-on transition-transform duration-100 active:scale-95 active:bg-surface-container-highest"
        >
          <ChevronLeft className="h-6 w-6 -translate-x-px" strokeWidth={2.25} aria-hidden />
        </button>
        {/* The step counter rides on the phase line rather than in its own column: with
            a separate column the step name was squeezed to "Inspe…" (and then split
            mid-word) at accessibility text sizes — and the step name is the one thing on
            this screen the driver must be able to read. It now wraps on word boundaries. */}
        <div className="flex-1 min-w-0">
          <p className="truncate text-subhead text-surface-on-variant">
            <span>{phaseName}</span>
            <span aria-hidden> · </span>
            <span className="tabular-nums">{current}/{total}</span>
          </p>
          <p className="text-title-3">{stepName}</p>
        </div>
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
          // Round red-tinted well, the mirror of the back button's grey one: the pair
          // frames the header symmetrically, and the tint keeps panic unmistakable.
          className="rounded-full bg-error-container/60 text-error hover:bg-error-container active:bg-error-container"
        />
      </div>
      {/* One segment per step of this phase: done steps solid, the step on screen tinted,
          the rest empty. A fill bar measured current/total showed 100% the moment a
          one-step phase opened — "finished" before the driver had done anything (M3). Same
          visual language as the trip strip on Home. */}
      <div className="flex gap-1" aria-hidden>
        {slugs.map((slug, index) => (
          <span
            key={slug}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              index < stepIndex ? 'bg-secondary' : index === stepIndex ? 'bg-secondary/40' : 'bg-surface-container-highest',
            )}
          />
        ))}
      </div>
    </header>
  )
}
