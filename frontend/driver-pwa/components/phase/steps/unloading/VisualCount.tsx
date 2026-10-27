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

export function VisualCount({ phase, stepIndex, draft, onUpdate, onComplete }: VisualCountProps) {
  const isBlocked = isPhaseBlocked(phase)

  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const trimmed = input.trim()
  const count = trimmed !== '' ? parseInt(trimmed, 10) : null
  const isValid = count === null || (!isNaN(count) && count >= 0)

  function step(by: 1 | -1) {
    const base = count !== null && !isNaN(count) && count >= 0 ? count : 0
    setInput(String(Math.max(0, base + by)))
  }

  function handleConfirm(): void | Promise<void> {
    onUpdate({ driverVisualCount: count })
    return onComplete()
  }

  if (isBlocked) {
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
  const roundButton = 'flex size-16 max-h-[72px] max-w-[72px] shrink-0 items-center justify-center rounded-full bg-fill text-surface-on transition-transform duration-100 active:scale-95 disabled:opacity-40'

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Count what comes off the truck, if you can. It’s optional. The warehouse scan is recorded either way."
      action={<SwipeToConfirm label="Swipe to Confirm Count" onConfirm={handleConfirm} disabled={!isValid} />}
    >
      <div className="mt-6 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <button type="button" aria-label="One fewer" onClick={() => step(-1)} disabled={notCounted || count === 0} className={roundButton}>
          <Minus className="size-6" strokeWidth={2.2} aria-hidden />
        </button>
        <div className="min-w-0 text-center">
          <label htmlFor="visual-count" className="sr-only">Your visual count at destination</label>
          <input
            id="visual-count"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="–"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={!isValid || undefined}
            aria-describedby="visual-count-note"
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
