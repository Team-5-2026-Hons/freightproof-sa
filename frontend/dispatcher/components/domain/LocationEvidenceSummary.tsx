import { Chip, type ChipType } from '@/components/ui/Chip'
import { formatSeparation } from '@/lib/phase/geo'
import { COMPARISON_UNAVAILABLE, PROXIMITY_LABELS, VERDICT_LABELS, hasAnyFix, type LocationEvidence } from '@/lib/phase/location-evidence'
import { cn } from '@shared/lib/utils/cn'

interface Props {
  evidence: LocationEvidence
  className?: string
}

const VERDICT_CHIP_TYPE: Record<LocationEvidence['verdict'], ChipType> = {
  within_tolerance: 'complete',
  outside_tolerance: 'transit',
  not_verified: 'pending',
  not_checked_yet: 'pending',
  no_verdict_for_phase: 'pending',
}

/**
 * Compact one-line summary for a timeline row: the stored verdict as a chip, plus the
 * measured separation (or a plain "unavailable") when a fix exists at all.
 *
 * Renders nothing for a phase that has neither a fix nor an evaluation yet: a pending
 * phase has nothing to say about location, and an empty chip row would just be noise
 * repeated down every unstarted phase in the timeline.
 */
export function LocationEvidenceSummary({ evidence, className }: Props) {
  if (!hasAnyFix(evidence) && evidence.verdict === 'not_checked_yet') return null

  const { separationMetres } = evidence

  return (
    <span className={cn('inline-flex items-center gap-[6px]', className)}>
      <Chip type={VERDICT_CHIP_TYPE[evidence.verdict]} label={VERDICT_LABELS[evidence.verdict]} />
      {separationMetres !== null && (
        <span className="text-[12px] text-on-surf-v tabular-nums">
          Driver–truck separation: {formatSeparation(separationMetres)}
        </span>
      )}
      {separationMetres === null && hasAnyFix(evidence) && (
        <span className="text-[12px] text-on-surf-v">{COMPARISON_UNAVAILABLE}</span>
      )}
      {evidence.proximity
        ? <span className="text-[12px] text-on-surf-v">Driver proximity: {PROXIMITY_LABELS[evidence.proximity]}</span>
        : separationMetres !== null
          ? <span className="text-[12px] text-on-surf-v">Recorded source separation; proximity not evaluated.</span>
          : null}
    </span>
  )
}
