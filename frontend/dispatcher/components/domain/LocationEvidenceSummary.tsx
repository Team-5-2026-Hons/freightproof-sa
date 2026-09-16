import { Chip, type ChipType } from '@/components/ui/Chip'
import { formatSeparation } from '@/lib/phase/geo'
import { COMPARISON_UNAVAILABLE, VERDICT_LABELS, hasAnyFix, type LocationEvidence } from '@/lib/phase/location-evidence'
import { cn } from '@shared/lib/utils/cn'

interface Props {
  evidence: LocationEvidence
  className?: string
}

// Follows the stored verdict (see verdictFor() in lib/phase/location-evidence.ts). Every
// non-tolerance verdict reads as 'pending' — none of them is a pass or a fail.
const VERDICT_CHIP_TYPE: Record<LocationEvidence['verdict'], ChipType> = {
  within_tolerance: 'complete',
  outside_tolerance: 'exception',
  not_verified: 'pending',
  not_checked_yet: 'pending',
  no_verdict_for_phase: 'pending',
}

/**
 * Compact one-line summary for a timeline row: the stored verdict as a chip, plus the
 * measured separation when a fix exists. Renders nothing for a phase with neither a fix
 * nor an evaluation yet.
 */
export function LocationEvidenceSummary({ evidence, className }: Props) {
  if (!hasAnyFix(evidence) && evidence.verdict === 'not_checked_yet') return null

  const { separationMetres } = evidence

  return (
    <span className={cn('inline-flex items-center gap-[6px]', className)}>
      <Chip type={VERDICT_CHIP_TYPE[evidence.verdict]} label={VERDICT_LABELS[evidence.verdict]} />
      {separationMetres !== null && (
        <span className="text-[11px] text-on-surf-v tabular-nums">
          {formatSeparation(separationMetres)} apart
        </span>
      )}
      {separationMetres === null && hasAnyFix(evidence) && (
        <span className="text-[11px] text-on-surf-v">{COMPARISON_UNAVAILABLE}</span>
      )}
    </span>
  )
}
