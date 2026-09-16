import { ChevronDown, ArrowRight } from 'lucide-react'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { Card } from '@/components/ui/Card'

interface CurrentPhaseCardProps {
  phase: PhaseDescriptor
  onSelect: () => void
}

// Sits directly under PhaseProgressBar's dots — the chevron visually continues from the
// highlighted "current" dot into this single actionable card. Only one phase is ever
// shown at a time; callers decide whether to render this at all.
//
// Uses the interactive Card (role="button" + Enter/Space handling) rather than Button
// asChild: this row's left-aligned icon+label+arrow layout doesn't fit Button's cva,
// which always forces centered/uppercase/font-bold text.
export function CurrentPhaseCard({ phase, onSelect }: CurrentPhaseCardProps) {
  return (
    // -mt-1 so the chevron reads as a continuation of the timeline dot directly above.
    <div className="-mt-1 flex flex-col items-center">
      <ChevronDown className="h-4 w-4 text-secondary" aria-hidden />
      <Card
        variant="default"
        onClick={onSelect}
        className="w-full rounded-2xl bg-secondary-container px-4 py-3 shadow-none hover:bg-secondary-container/80"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-on">
              {phase.sequence_number}
            </span>
            <span className="font-semibold text-secondary-on-container">
              {PHASE_NAMES[phase.phase_type]}
              {/* Disambiguates a repeated phase type on a cross-dock plan. */}
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
