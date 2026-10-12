// frontend/driver-pwa/components/trip/PhaseProgressBar.tsx
'use client'

import { Check, AlertTriangle } from 'lucide-react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, phaseLocation } from '@/lib/phase'
import { cn } from '@/lib/utils'

interface PhaseProgressBarProps {
  phases: readonly PhaseDescriptor[]
}

type PhaseStageState = 'completed' | 'current' | 'exception' | 'upcoming'

const DOT_CLASSES: Record<PhaseStageState, string> = {
  completed: 'bg-primary border-primary text-primary-on',
  // The ring is what makes "you are here" findable at a glance halfway down an 11-row
  // cross-dock plan; colour alone would not survive a glance in a moving cab.
  current:   'bg-secondary border-secondary text-secondary-on ring-4 ring-secondary/20',
  exception: 'bg-error border-error text-error-on',
  upcoming:  'bg-surface-container-lowest border-outline-variant text-surface-on-variant',
}

// Label weight tracks the same state as the dot — the driver should be able to find
// "where am I" from the text column alone, without colour-matching against the dots.
const LABEL_CLASSES: Record<PhaseStageState, string> = {
  completed: 'text-surface-on',
  current:   'text-surface-on font-semibold',
  exception: 'text-error font-semibold',
  // /80: upcoming rows are the rest of the trip and must stay readable (≥ 4.5:1).
  upcoming:  'text-surface-on-variant/80',
}

// Words only where a word adds something the dot cannot: "Current" and "Issue". The old
// "Done"/"Pending" column repeated what every dot already said, on every row.
const STATUS_WORD: Partial<Record<PhaseStageState, { text: string; className: string }>> = {
  current:   { text: 'Current', className: 'text-secondary' },
  exception: { text: 'Issue', className: 'text-error' },
}

function stageStateFor(phase: PhaseDescriptor, current: PhaseDescriptor | null): PhaseStageState {
  if (phase.status === 'completed' || phase.status === 'overridden') return 'completed'
  if (phase.status === 'exception') return 'exception'
  if (current !== null && phase.phase_event_id === current.phase_event_id) return 'current'
  return 'upcoming'
}

// The trip's full phase plan as a vertical timeline: a trip is a journey, so the plan reads
// as one — dots joined by a rail, solid where the trip has been, quiet where it is going.
// Renders exactly `phases.length` rows — DATA, never a fixed count: a single-leg trip is 8
// rows, a three-stop cross-dock is 13 (lib/phase/derive.ts's own header comment).
//
// Circles show the phase's plain plan position (sequence_number), never internal
// phase-type codes.
export function PhaseProgressBar({ phases }: PhaseProgressBarProps) {
  // Plan order is never trusted off the wire (mirrors lib/phase/derive.ts's own
  // bySequence) — sort a defensive copy rather than assume callers already did.
  const sorted = [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
  const current = currentPhase(sorted)

  return (
    <div className="rounded-2xl bg-surface-container-lowest p-4 shadow-level-2">
      <ol aria-label="Trip phases">
        {sorted.map((phase, index) => {
          const state = stageStateFor(phase, current)
          const isLast = index === sorted.length - 1
          const stop = phaseLocation(sorted, phase)
          const status = STATUS_WORD[state]

          return (
            <li
              key={phase.phase_event_id}
              aria-current={state === 'current' ? 'step' : undefined}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {/* The rail to the next dot. Solid once this phase is done — the trip has
                  travelled that stretch — and a quiet hairline ahead of the driver. */}
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-0 left-[13px] top-7 w-0.5 rounded-full',
                    state === 'completed' ? 'bg-primary' : 'bg-outline-variant/60',
                  )}
                />
              )}

              <div
                className={cn(
                  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-caption font-semibold tabular-nums',
                  DOT_CLASSES[state],
                )}
              >
                {state === 'completed' ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                ) : state === 'exception' ? (
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                ) : (
                  phase.sequence_number
                )}
              </div>

              {/* min-w-0 lets the label wrap inside the row instead of pushing the status
                  word off a 320px screen. */}
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-0.5">
                <div className="min-w-0">
                  <p className={cn('text-body', LABEL_CLASSES[state])}>{PHASE_NAMES[phase.phase_type]}</p>
                  {/* Where it happens. Also what tells two "Unloading" rows apart on a
                      cross-dock plan. Null only for trip_creation. */}
                  {stop !== null && <p className="text-footnote text-surface-on-variant">{stop}</p>}
                </div>
                {status && (
                  <span className={cn('shrink-0 pt-0.5 text-footnote font-semibold', status.className)}>
                    {status.text}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
