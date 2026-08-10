// frontend/driver-pwa/components/trip/CurrentPhaseCard.tsx
import { ChevronDown, ArrowRight } from 'lucide-react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { Card } from '@/components/ui/Card'

interface CurrentPhaseCardProps {
  phase: PhaseDescriptor
  onSelect: () => void
}

// Sits directly under PhaseProgressBar's dots — the chevron visually continues from
// the highlighted "current" dot into this single actionable card. Replaces the old
// multi-item "Handshakes" list: only ever one phase is shown at a time (see
// docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md,
// unchanged design intent under the phase model). Callers decide whether to render
// this at all — it has no "nothing to show" state.
//
// Uses the interactive Card (role="button" + Enter/Space handling already built into
// components/ui/Card.tsx) rather than Button asChild: this row's content (icon circle +
// label + trailing arrow, left-aligned, normal case) doesn't fit Button's cva, which
// always forces centered/uppercase/font-bold text — asChild would just fight that
// layout with overrides. Card's onClick path gives the same real keyboard semantics
// without the mismatch, and the colors/padding are overridden via className.
export function CurrentPhaseCard({ phase, onSelect }: CurrentPhaseCardProps) {
  return (
    // -mt-1: the chevron is meant to read as a continuation of the current phase's dot
    // on the timeline directly above, so it has to sit closer to that rail than the
    // caller's own section gap allows — at full gap it floats between the two and
    // reads as decoration.
    <div className="-mt-1 flex flex-col items-center">
      <ChevronDown className="h-4 w-4 text-secondary" aria-hidden />
      <Card
        variant="default"
        onClick={onSelect}
        className="w-full rounded-2xl bg-secondary-container px-4 py-3 shadow-none hover:bg-secondary-container/80"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* sequence_number is the phase's own position in THIS trip's plan —
                DATA, not a bounded 1-5 handshake ordinal — so it renders unchanged
                whether this is a 7-row single-leg trip or an 11-row cross-dock. */}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-on">
              {phase.sequence_number}
            </span>
            <span className="font-semibold text-secondary-on-container">
              {PHASE_NAMES[phase.phase_type]}
              {/* Disambiguates a repeated phase type on a cross-dock plan (e.g. the
                  second of three `unloading` occurrences) — stop_sequence is null
                  only for trip_creation, which never reaches the driver as "current". */}
              {phase.stop_sequence !== null && (
                <span className="ml-1.5 font-normal opacity-80">Stop {phase.stop_sequence}</span>
              )}
            </span>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-secondary" aria-hidden />
        </div>
      </Card>
    </div>
  )
}
