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

// Label weight tracks the same state as the dot — the driver should be able to find
// "where am I" from the text column alone, without colour-matching against the dots.
const LABEL_CLASSES: Record<PhaseStageState, string> = {
  completed: 'text-surface-on-variant',
  current:   'text-surface-on font-semibold',
  exception: 'text-error font-semibold',
  upcoming:  'text-surface-on-variant/70',
}

// Right-hand status column. Words, not another colour cue: the dot already carries
// colour, and a driver glancing at 11 rows in a cab needs the plan to be readable in
// one pass without decoding a palette. Kept short so the longest of them still clears
// the phase label on a 320px screen.
const STATUS_LABELS: Record<PhaseStageState, string> = {
  completed: 'Done',
  current:   'Current',
  exception: 'Issue',
  upcoming:  'Pending',
}

const STATUS_CLASSES: Record<PhaseStageState, string> = {
  completed: 'text-surface-on-variant',
  current:   'text-secondary',
  exception: 'text-error',
  upcoming:  'text-surface-on-variant/60',
}

// The current row is tinted rather than only bolded: with the rows now separated by
// hairlines instead of a connector rail, weight alone is too quiet to find at a glance
// halfway down an 11-row cross-dock plan.
const ROW_CLASSES: Record<PhaseStageState, string> = {
  completed: '',
  current:   'bg-secondary-container/40',
  exception: 'bg-error-container/30',
  upcoming:  '',
}

const DOT_SIZE_CLASS = 'h-7 w-7'

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

// The trip's full phase plan as a table. Renders exactly `phases.length` rows — DATA,
// never a fixed 5: a single-leg trip is 7 rows, a three-stop cross-dock is 11
// (lib/phase/derive.ts's own header comment).
//
// Framed and column-aligned, matching TripTable — same border, header strip and
// hairline dividers, so the list of trips and the plan inside one trip read as the same
// kind of object. The previous free-standing dot-and-connector timeline sat directly on
// the page background with nothing bounding it, which left every row looking like it
// was floating between the status chip above and the CTA below; a frame plus a fixed
// status column gives the rows an edge to align to. The dividers now do the connector's
// job of tying consecutive rows together.
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
    <div className="overflow-hidden rounded-xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient-sm">
      {/* Column labels, not content — the rows below are a list, not a <table>, so this
          strip is decorative and hidden from assistive tech, which reads each row's own
          text in order instead. Identical treatment to TripTable's header. */}
      <div
        className="flex items-center justify-between gap-3 border-b border-outline-variant/25 bg-surface-container-low px-3 py-2 xs:px-4"
        aria-hidden
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant">Phase</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant">Status</span>
      </div>

      <ol aria-label="Trip phases" className="divide-y divide-outline-variant/20">
        {sorted.map((phase) => {
          const state = stageStateFor(phase, current)

          return (
            <li
              key={phase.phase_event_id}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 transition-colors duration-200 xs:px-4',
                ROW_CLASSES[state],
              )}
            >
              <div
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-200',
                  DOT_SIZE_CLASS,
                  DOT_CLASSES[state],
                )}
              >
                {state === 'completed' ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                ) : state === 'exception' ? (
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                ) : (
                  phase.sequence_number
                )}
              </div>

              {/* min-w-0 is what lets the truncate below actually fire: a flex child
                  defaults to min-width:auto and refuses to shrink under its content,
                  which is how a long phase label pushes the status column off a 320px
                  screen (same reasoning as TripTable's own row). */}
              <div className="flex min-w-0 flex-1 flex-col">
                <p className={cn('truncate text-sm leading-tight', LABEL_CLASSES[state])}>
                  {PHASE_NAMES[phase.phase_type]}
                </p>
                {/* Disambiguates a repeated phase type on a cross-dock plan (e.g. the
                    second of three `unloading` rows) — stop_sequence is null only for
                    trip_creation. Without it two identical "Unloading" labels are
                    indistinguishable. */}
                {phase.stop_sequence !== null && (
                  <p className="truncate text-xs leading-tight text-surface-on-variant">
                    Stop {phase.stop_sequence}
                  </p>
                )}
              </div>

              <span
                className={cn(
                  'shrink-0 text-[10px] font-bold uppercase tracking-wider',
                  STATUS_CLASSES[state],
                )}
              >
                {STATUS_LABELS[state]}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
