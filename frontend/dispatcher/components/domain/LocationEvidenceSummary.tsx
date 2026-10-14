import { Chip, type ChipType } from '@/components/ui/Chip'
import { formatSeparation } from '@/lib/phase/geo'
import { COMPARISON_UNAVAILABLE, PROXIMITY_LABELS, VERDICT_LABELS, hasAnyFix, type LocationEvidence } from '@/lib/phase/location-evidence'
import { cn } from '@shared/lib/utils/cn'

interface Props {
  evidence: LocationEvidence
  className?: string
}

// Chip colouring follows the stored verdict, not a browser-computed one: see
// verdictFor() in lib/phase/location-evidence.ts. Every non-tolerance verdict (not
// verified, not checked yet, no verdict for this phase) reads as 'pending': none of
// them is a pass or a fail, they're all "nothing decisive is recorded".
//
// outside_tolerance deliberately does NOT use the 'exception' chip type here: this
// summary sits on the phase card itself, right above the phase's own exception branch
// (which already carries an amber 'exception'-type severity chip when the tolerance
// breach produced a logged exception). Two amber chips stacked a few pixels apart for
// the same fact read as duplicated errors, not two distinct signals — 'transit' (blue)
// keeps this reading as "here's the live check result" rather than a second alarm.
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
