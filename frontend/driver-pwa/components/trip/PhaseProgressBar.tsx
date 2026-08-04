// frontend/driver-pwa/components/trip/PhaseProgressBar.tsx
'use client'

import { Check, AlertTriangle } from 'lucide-react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase } from '@/lib/phase'
import { cn } from '@/lib/utils'

interface PhaseProgressBarProps {
  phases: readonly PhaseDescriptor[]
}

type PhaseStageState = 'completed' | 'current' | 'exception' | 'upcoming'

const DOT_CLASSES: Record<PhaseStageState, string> = {
  completed: 'bg-primary border-primary text-primary-on',
  current:   'bg-secondary border-secondary text-secondary-on',
  exception: 'bg-error border-error text-error-on',
  upcoming:  'bg-surface-container-lowest border-outline-variant text-surface-on-variant',
}

const CONNECTOR_CLASSES: Record<PhaseStageState, string> = {
  completed: 'bg-primary',
  current:   'bg-outline-variant/40',
  exception: 'bg-outline-variant/40',
  upcoming:  'bg-outline-variant/40',
}

// Label weight tracks the same state as the dot — the driver should be able to find
// "where am I" from the text column alone, without colour-matching against the rail.
const LABEL_CLASSES: Record<PhaseStageState, string> = {
  completed: 'text-surface-on-variant',
  current:   'text-surface-on font-semibold',
  exception: 'text-error font-semibold',
  upcoming:  'text-surface-on-variant/70',
}

// Every row reserves at least the dot's own height so the label sits centred against
// its dot regardless of how much text it carries — one row with a "Stop 2" line and
// one without still line up with their dots. Must stay equal to DOT_SIZE_CLASS's
// height, or labels drift off their own dots.
const ROW_MIN_HEIGHT_CLASS = 'min-h-8'
const DOT_SIZE_CLASS = 'h-8 w-8'

// Row gap. 7 rows on a single-leg trip and 11 on a cross-dock, each previously
// 36px of dot plus 16px of gap — the timeline alone overran a 390pt phone before the
// current-phase CTA underneath it was even reached. 32 + 12 keeps every row of a
// single-leg plan on one screen with the CTA still visible.
const ROW_GAP_CLASS = 'pb-3'

// A phase's dot state is read straight off its own `status` — the old
// lib/utils/handshake-progress.ts existed only to reconstruct this by scanning for
// fixed sequence numbers 1-5 against a separate handshake-events array; a phase plan
// row already carries its own status directly, so there is nothing left to
// reconstruct. `currentPhase()` (lib/phase) still owns the one piece of real
// derivation used here: which unresolved phase is "current".
function stageStateFor(phase: PhaseDescriptor, current: PhaseDescriptor | null): PhaseStageState {
  if (phase.status === 'completed' || phase.status === 'overridden') return 'completed'
  if (phase.status === 'exception') return 'exception'
  if (current !== null && phase.phase_event_id === current.phase_event_id) return 'current'
  return 'upcoming'
}

// Vertical timeline over the trip's full phase plan. Renders exactly `phases.length`
// rows — DATA, never a fixed 5: a single-leg trip is 7 rows, a three-stop cross-dock is
// 11 (lib/phase/derive.ts's own header comment).
//
// Vertical, not the horizontal stepper this replaced: at 7-11 rows the horizontal bar
// could only fit ~5 dots on a 390pt phone, so the rest lived off-screen behind a
// sideways scroll a driver had no reason to expect, and each label was squeezed into a
// 64px column at 10px type. Down the page every phase is visible in one glance at full
// label size, and the list grows with the plan instead of scrolling out of sight — which
// also removes the old scroll-the-current-dot-into-view effect entirely, since the rows
// now sit in normal document flow rather than in their own scroll container.
//
// Circles show the phase's plain plan position (sequence_number), never internal
// phase-type codes — mirrors the old handshake bar's same driver-facing reasoning.
export function PhaseProgressBar({ phases }: PhaseProgressBarProps) {
  // Plan order is never trusted off the wire (mirrors lib/phase/derive.ts's own
  // bySequence) — this is the one place in the component that needs a stable
  // top-to-bottom order, so it sorts its own defensive copy rather than assuming
  // callers already did.
  const sorted = [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
  const current = currentPhase(sorted)

  return (
    <ol aria-label="Trip phases" className="flex flex-col">
      {sorted.map((phase, i) => {
        const state = stageStateFor(phase, current)
        const isLast = i === sorted.length - 1

        return (
          <li
            key={phase.phase_event_id}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex gap-3"
          >
            {/* Rail column: dot, then the connector running down to the next dot. A
                segment's colour reflects the phase it flows OUT of, so the rail reads
                as "progress reached this far" rather than as a property of the row
                below it. The last row has nothing to connect to. */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors duration-200',
                  DOT_SIZE_CLASS,
                  DOT_CLASSES[state],
                )}
              >
                {state === 'completed' ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                ) : state === 'exception' ? (
                  <AlertTriangle className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                ) : (
                  phase.sequence_number
                )}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    'my-1 w-0.5 flex-1 rounded-full transition-colors duration-200',
                    CONNECTOR_CLASSES[state],
                  )}
                />
              )}
            </div>

            <div className={cn('flex flex-1 flex-col justify-center', !isLast && ROW_GAP_CLASS)}>
              <div className={cn('flex flex-col justify-center', ROW_MIN_HEIGHT_CLASS)}>
                <p className={cn('text-sm leading-tight', LABEL_CLASSES[state])}>
                  {PHASE_NAMES[phase.phase_type]}
                </p>
                {/* Disambiguates a repeated phase type on a cross-dock plan (e.g. the
                    second of three `unloading` rows) — stop_sequence is null only for
                    trip_creation. The old horizontal cell had no room for this; a full
                    -width row does, and without it two identical "Unloading" labels are
                    indistinguishable. */}
                {phase.stop_sequence !== null && (
                  <p className="text-xs leading-tight text-surface-on-variant">
                    Stop {phase.stop_sequence}
                  </p>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
