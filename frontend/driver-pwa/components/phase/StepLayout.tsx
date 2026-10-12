'use client'

import type { ReactNode } from 'react'
import { Check, Circle } from 'lucide-react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { StepHeader } from '@/components/phase/StepHeader'
import { cn } from '@/lib/utils'

/** One thing a step needs before its confirm unlocks, and whether it is done yet. */
export interface StepRequirement {
  label: string
  met: boolean
}

interface StepLayoutProps {
  phase: PhaseDescriptor
  stepIndex: number
  /** One or two sentences on what this step is for. */
  intro?: ReactNode
  /**
   * What must be done before the action unlocks, shown as a live checklist above it. The
   * step still owns the real gate (its `disabled` on the action); this is the explanation.
   */
  requirements?: readonly StepRequirement[]
  /** The step's confirm control. Omit to render no footer (blocked or waiting states). */
  action?: ReactNode
  /** Centre the body — for completion and confirmation screens with a single message. */
  centered?: boolean
  children?: ReactNode
}

// The one frame every evidence step is built in (design audit step 6). Before this, ten
// step components each hand-built the same header / intro / content / swipe stack, and the
// swipe simply sat greyed out when something was missing — a driver had to work out for
// themselves which of three fields was still empty (H8). Now the step declares its
// requirements and the footer says, live, what is done and what is not.
export function StepLayout({
  phase, stepIndex, intro, requirements = [], action, centered = false, children,
}: StepLayoutProps) {
  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />

      <div className={cn('flex flex-1 flex-col gap-6 p-4', centered && 'items-center justify-center text-center')}>
        {intro !== undefined && <p className="text-body leading-relaxed text-surface-on-variant">{intro}</p>}
        {children}
      </div>

      {action !== undefined && (
        // Pinned, on the same glass as the header: the confirm is one thumb away however
        // long the step is, and the step's content scrolls underneath it. The bottom
        // padding never drops below 1.5rem so the swipe's "swipe all the way" hint, which
        // renders just under the track, stays on screen even where the inset reads 0.
        <footer className="glass-nav sticky bottom-0 z-sticky border-t border-outline-variant/25 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          {requirements.length > 0 && <RequirementChecklist requirements={requirements} />}
          <div className="flex justify-center">{action}</div>
        </footer>
      )}
    </main>
  )
}

// Ticks fill in as the driver works, so the list doubles as "what this step wants" before
// anything is done and as confirmation once it all is. Met items recede; the ones still
// needed stay at full strength — the eye lands on what is left.
// Exported for forms outside the phase steps (Log Exception) that gate a submit the same way.
export function RequirementChecklist({ requirements }: { requirements: readonly StepRequirement[] }) {
  return (
    <ul aria-label="Needed to continue" className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
      {requirements.map(({ label, met }) => (
        <li key={label} className="flex items-center gap-1.5 text-footnote">
          {met ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-success-on">
              <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
            </span>
          ) : (
            <Circle className="h-4 w-4 text-outline" strokeWidth={2} aria-hidden />
          )}
          <span className={met ? 'text-surface-on-variant' : 'font-semibold text-surface-on'}>
            <span className="sr-only">{met ? 'Done: ' : 'Still needed: '}</span>
            {label}
          </span>
        </li>
      ))}
    </ul>
  )
}
