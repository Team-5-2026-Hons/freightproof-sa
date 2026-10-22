'use client'

import { Check, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, phaseLocation, stepsFor } from '@/lib/phase'
import { formatTime } from '@/lib/utils/format-time'
import { cn } from '@/lib/utils'

type RowState = 'done' | 'current' | 'exception' | 'upcoming'

function stateOf(phase: PhaseDescriptor, current: PhaseDescriptor | null): RowState {
  if (phase.status === 'exception') return 'exception'
  if (phase.status === 'completed' || phase.status === 'overridden') return 'done'
  return phase.phase_event_id === current?.phase_event_id ? 'current' : 'upcoming'
}

// Spoken state, so nothing on the row depends on its colour or marker alone.
const SPOKEN: Record<RowState, string> = {
  done: 'Done',
  current: 'Now',
  exception: 'Issue recorded',
  upcoming: 'Not started',
}

function Marker({ state, number }: { state: RowState; number: number }) {
  const base = 'flex size-7 shrink-0 items-center justify-center rounded-full text-footnote font-bold tabular-nums'
  if (state === 'done') {
    return <span aria-hidden className={cn(base, 'bg-surface-on text-surface')}><Check className="size-3.5" strokeWidth={3} /></span>
  }
  if (state === 'exception') {
    return <span aria-hidden className={cn(base, 'bg-error-tint text-error')}><TriangleAlert className="size-3.5" strokeWidth={2.5} /></span>
  }
  if (state === 'current') {
    // Blue means progress, and this is where progress is.
    return <span aria-hidden className={cn(base, 'bg-secondary text-secondary-on ring-4 ring-secondary-container')}>{number}</span>
  }
  return <span aria-hidden className={cn(base, 'border-2 border-surface-container-high text-surface-on-variant')}>{number}</span>
}

// A phase can complete while its Hedera anchor failed (fail-open, see phase-meta
// ANCHORED_PHASES) — so the row never shows a plain success for that pairing.
function AnchorMark({ phase }: { phase: PhaseDescriptor }) {
  if (phase.anchor_status === 'anchored') {
    return <ShieldCheck role="img" aria-label="Anchored on Hedera" className="size-4 shrink-0 text-chain" strokeWidth={2.25} />
  }
  if (phase.anchor_status === 'pending') return <span className="shrink-0 text-footnote text-surface-on-variant">Anchoring…</span>
  if (phase.anchor_status === 'failed') return <span className="shrink-0 text-footnote font-semibold text-attention">Receipt owed</span>
  return null
}

interface PhaseListProps {
  phases: readonly PhaseDescriptor[]
  /** Makes the current phase's row open its first step. Omit (e.g. on hold) for a static list. */
  onSelectCurrent?: (phase: PhaseDescriptor) => void
  /** Record mode: show when each completed phase was recorded. */
  showTimes?: boolean
}

/**
 * Every phase of the plan as a list. The plan's
 * length is data: a cross-dock plan simply has more rows, repeated phase types are kept,
 * and each row names its stop so two "Unloading" rows can be told apart.
 */
export function PhaseList({ phases, onSelectCurrent, showTimes = false }: PhaseListProps) {
  const sorted = [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
  const current = currentPhase(sorted)
  const driverPhases = sorted.filter((p) => p.phase_type !== 'trip_creation')

  return (
    <ol aria-label="Trip phases" className="flex flex-col">
      {driverPhases.map((phase, i) => {
        const state = stateOf(phase, current)
        const where = phaseLocation(sorted, phase)
        const tappable = state === 'current' && onSelectCurrent !== undefined && stepsFor(phase).length > 0
        const body = (
          <>
            <Marker state={state} number={i + 1} />
            <span className="min-w-0 flex-1">
              <span className={cn('block text-body', state === 'upcoming' ? 'text-surface-on-variant' : 'text-surface-on', state === 'current' && 'font-semibold')}>
                {PHASE_NAMES[phase.phase_type]}
              </span>
              <span className="block text-footnote text-surface-on-variant">
                {[SPOKEN[state], where].filter(Boolean).join(' · ')}
              </span>
            </span>
            {showTimes && state === 'done' && phase.completed_at !== null && (
              <span className="shrink-0 text-subhead tabular-nums text-surface-on-variant">{formatTime(phase.completed_at)}</span>
            )}
            {state === 'done' && <AnchorMark phase={phase} />}
          </>
        )
        return (
          <li key={phase.phase_event_id} aria-current={state === 'current' ? 'step' : undefined}>
            {tappable ? (
              <button
                type="button"
                onClick={() => onSelectCurrent(phase)}
                className="flex min-h-[56px] w-full items-center gap-3.5 bg-secondary-container/40 px-5 py-2 text-left transition-colors duration-100 active:bg-secondary-container/70"
              >
                {body}
              </button>
            ) : (
              <div className="flex min-h-[56px] items-center gap-3.5 px-5 py-2">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
