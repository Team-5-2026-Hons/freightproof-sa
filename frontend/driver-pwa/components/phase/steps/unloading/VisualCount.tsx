'use client'

import { useState } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { WarehouseWaitAction, WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import { isPhaseBlocked } from '@/lib/phase'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

interface VisualCountProps {
  phase: PhaseDescriptor
  stepIndex: number
  draft: UnloadingEvidence
  onUpdate: (patch: Partial<UnloadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

// Blind entry: never show the driver a number to match. The server reconciles this count
// privately against loading's driver_visual_count; a reference figure would defeat the
// purpose of an independent count.
//
// Also gates on the warehouse's own destination scan (GATED_PHASES[UNLOADING],
// orchestration/phase_gate.py) — see loading/Linehaul.tsx for why the swipe is hidden
// entirely rather than left visible-but-disabled while blocked.
export function VisualCount({ phase, stepIndex, draft, onUpdate, onComplete }: VisualCountProps) {
  const isBlocked = isPhaseBlocked(phase)

  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const trimmed = input.trim()
  // Empty is a legitimate "I didn't count" and submits as null. A typed count must be a
  // real >=0 integer — zero is a valid observation, negative is meaningless.
  const count = trimmed !== '' ? parseInt(trimmed, 10) : null
  const isValid = count === null || (!isNaN(count) && count >= 0)

  // The stepper: the driver counts as parcels come off, one tap each.
  // From blank (or an unreadable entry) + starts at 1; − never goes below a real zero.
  function step(by: 1 | -1) {
    const base = count !== null && !isNaN(count) && count >= 0 ? count : 0
    setInput(String(Math.max(0, base + by)))
  }

  function handleConfirm(): void | Promise<void> {
    onUpdate({ driverVisualCount: count })
    return onComplete()
  }

  if (isBlocked) {
    // Server is the authority (409s regardless); this just tells the driver why.
    return (
      <StepLayout phase={phase} stepIndex={stepIndex} showTitle={false} action={<WarehouseWaitAction />}>
        <WarehouseWaitCard title="Unloading in progress">
          The warehouse is scanning parcels off the truck. This step will unlock on its own
          when they finish. Nothing to do yet.
        </WarehouseWaitCard>
      </StepLayout>
    )
  }

  const notCounted = trimmed === ''
  // Physical controls, capped in px: in rem they reached 160px each at the largest text
  // size and pushed + off the screen. 72px stays far above the 44pt minimum.
  const roundButton = 'flex size-16 max-h-[72px] max-w-[72px] shrink-0 items-center justify-center rounded-full bg-fill text-surface-on transition-transform duration-100 active:scale-95 disabled:opacity-40'

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Count what comes off the truck, if you can. It’s optional. The warehouse scan is recorded either way."
      // No checklist: the count is optional. An invalid entry is explained under the number.
      action={<SwipeToConfirm label="Swipe to Confirm Count" onConfirm={handleConfirm} disabled={!isValid} />}
    >
      <div className="mt-6 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <button type="button" aria-label="One fewer" onClick={() => step(-1)} disabled={notCounted || count === 0} className={roundButton}>
          <Minus className="size-6" strokeWidth={2.2} aria-hidden />
        </button>
        <div className="min-w-0 text-center">
          <label htmlFor="visual-count" className="sr-only">Your visual count at destination</label>
          {/* Typeable as well as steppable: a driver who counted on paper enters it
              directly. Blind — no reference number is ever shown beside it. */}
          <input
            id="visual-count"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="–"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={!isValid || undefined}
            aria-describedby="visual-count-note"
            // size={1} + min-w-0: an input's intrinsic width is ~20 characters, which at
            // this font size pushed the + button off the screen at large text.
            size={1}
            className="w-full min-w-0 bg-transparent text-center text-[min(4.5rem,96px)] font-bold leading-none tracking-tight text-surface-on tabular-nums outline-none placeholder:text-surface-on-variant focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-primary"
          />
          <p id="visual-count-note" className={cn('mt-1.5 text-subhead', isValid ? 'text-surface-on-variant' : 'font-medium text-error')}>
            {!isValid ? 'Enter a whole number of parcels, or leave it blank.' : notCounted ? 'Not counted' : 'parcels unloaded'}
          </p>
        </div>
        <button type="button" aria-label="One more" onClick={() => step(1)} className={roundButton}>
          <Plus className="size-6" strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      <div className="flex justify-center">
        {/* Lit while the count is blank, so "not counted" is a visible answer the driver
            gave, not an empty box they may have missed. Sends null, never zero. */}
        <button
          type="button"
          aria-pressed={notCounted}
          onClick={() => setInput('')}
          className={cn(
            'h-11 rounded-full px-[18px] text-subhead font-semibold transition-colors',
            notCounted ? 'bg-surface-on text-surface' : 'bg-fill text-surface-on',
          )}
        >
          I couldn’t count
        </button>
      </div>
    </StepLayout>
  )
}
