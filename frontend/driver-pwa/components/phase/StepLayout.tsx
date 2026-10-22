'use client'

import type { ReactNode } from 'react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { StepHeader } from '@/components/phase/StepHeader'
import { RequirementChips } from '@/components/ui/RequirementChips'
import { STEP_NAMES, STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { stepTitle } from '@/lib/phase/step-titles'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'
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
  /**
   * False when the body brings its own h1 — the warehouse waiting screen, where the step's
   * task ("Check the linehaul sheet") is not what is happening yet.
   */
  showTitle?: boolean
  children?: ReactNode
}

// The one frame every evidence step is built in. Before this, ten
// step components each hand-built the same header / intro / content / swipe stack, and the
// swipe simply sat greyed out when something was missing — a driver had to work out for
// themselves which of three fields was still empty. Now the step declares its
// requirements and the footer says, live, what is done and what is not.
export function StepLayout({
  phase, stepIndex, intro, requirements = [], action, centered = false, showTitle = true, children,
}: StepLayoutProps) {
  const largeText = useAccessibilityTextSize()
  const slug = STEP_SLUGS[phase.phase_type][stepIndex] ?? ''
  const title = stepTitle(slug) ?? STEP_NAMES[phase.phase_type][stepIndex] ?? ''

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <StepHeader phase={phase} stepIndex={stepIndex} />

      {/* Title, then one or two sentences on why, then the step: the driver
          reads what to do before anything asks for a tap. */}
      <div className={cn('flex flex-1 flex-col gap-6 px-5 pb-6 pt-6', centered && 'items-center justify-center text-center')}>
        {showTitle && (
          <div className="flex flex-col gap-2">
            <h1 className="text-title-1 tracking-tight text-surface-on">{title}</h1>
            {intro !== undefined && <p className="text-body text-surface-on-variant">{intro}</p>}
          </div>
        )}
        {children}
      </div>

      {action !== undefined && (
        // Pinned at normal sizes; at accessibility text sizes it flows after the step
        // instead, because pinned it would cover more than half the screen.
        <footer className={cn('glass-nav border-t border-hairline px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]', !largeText && 'sticky bottom-0 z-sticky')}>
          {requirements.length > 0 && <RequirementChecklist requirements={requirements} />}
          <div className="flex justify-center">{action}</div>
        </footer>
      )}
    </main>
  )
}

/**
 * What a step still needs, as chips above its confirm. Kept under its old name for the
 * In Transit forms that share it; the look is RequirementChips.
 */
export function RequirementChecklist({ requirements }: { requirements: readonly StepRequirement[] }) {
  return <RequirementChips requirements={requirements} className="mb-3" />
}
