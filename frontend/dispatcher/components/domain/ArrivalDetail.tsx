'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { departureSealForLeg } from '@/lib/phase/derive'
import { locationEvidenceForPhase, hasLocationEvidence } from '@/lib/phase/location-evidence'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor, SealCondition } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  artifactLoading?: boolean
  artifactError?: string | null
  onRetryArtifacts?: () => void
  // Every seal finding recorded on THIS row — design note §4.2/§4.3: a single arrival
  // can carry seal_compromised (broken/missing) AND seal_mismatch (wrong number)
  // together, so this is a list, never a single exception like UnloadingDetail's was.
  sealExceptions?: readonly Pick<TripException, 'exception_type' | 'severity'>[]
  phase: PhaseDescriptor
  // Needed to find THIS leg's own departure — see departureSealForLeg. A cross-dock
  // trip has one departure per leg, so a plain "the trip's departure" lookup would
  // compare a later leg's arrival against an earlier leg's seal.
  allPhases: readonly PhaseDescriptor[]
  artifactsById: Map<string, EvidenceArtifactWithUrl>
  // The precinct this phase is anchored to (the destination stop), resolved by the
  // page from the phase's stop. Arrival is a stop-anchored phase (design note §4.5.3),
  // so it gets the same geofence verdict as unloading, never in_transit's "no verdict".
  precinct: Precinct | undefined
}

const SEAL_CONDITION_LABELS: Record<SealCondition, string> = {
  intact: 'Intact',
  damaged: 'Damaged',
  missing: 'Missing',
}

interface Finding {
  key: string
  text: string
  tone: 'ok' | 'warn' | 'err'
}

/** One line per recorded seal finding, or a single "seals match" line when the row
 *  closed clean. Never collapses two simultaneous findings into one — see the Props
 *  comment on sealExceptions. */
function sealFindings(
  sealExceptions: readonly Pick<TripException, 'exception_type' | 'severity'>[],
  departureSeal: string | null,
  phase: PhaseDescriptor,
): Finding[] {
  if (sealExceptions.length > 0) {
    return sealExceptions.map((exception, index) => ({
      key: `${exception.exception_type}-${index}`,
      text: exception.exception_type === 'seal_mismatch'
        ? `Mismatch — recorded as a ${exception.severity} exception ✗`
        : exception.exception_type === 'seal_compromised'
          ? `Seal compromised — recorded as a ${exception.severity} exception ✗`
          : 'Seal continuity unverified',
      tone: exception.severity === 'critical' ? 'err' : 'warn',
    }))
  }
  // No recorded finding: clean only when there is something to compare and it matches.
  if (departureSeal && phase.seal_number && phase.status === 'completed' && departureSeal === phase.seal_number) {
    return [{ key: 'match', text: 'Recorded seals match ✓', tone: 'ok' }]
  }
  return []
}

const FINDING_TONE_CLASS: Record<Finding['tone'], string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
}

/**
 * The seal AS FOUND at the gate, before anything is opened — design note §4.2. Moved
 * out of UnloadingDetail: arrival is the custody boundary, completed and anchored
 * before unloading can even start, so this is where the intact-seal check and its
 * findings now live.
 */
export function ArrivalDetail({ artifactLoading, artifactError, onRetryArtifacts,
  phase, allPhases, artifactsById, sealExceptions = [], precinct,
}: Props) {
  const departureSeal = departureSealForLeg(allPhases, phase)
  const findings = sealFindings(sealExceptions, departureSeal, phase)

  return (
    <PhaseDetailCard>

      <Section title="Seal as found">
        <div className="col-span-2">
          <div className="text-[10px] text-on-surf-v mb-[3px]">Seal read at arrival</div>
          {phase.seal_number ? (
            <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-on-surf text-surf-lowest rounded-sm px-[10px] py-[3px]">
              {phase.seal_number}
            </span>
          ) : (
            <span className="text-[12px] text-on-surf-v">No seal present</span>
          )}
        </div>
        <Field label="Condition as found" value={phase.seal_condition ? SEAL_CONDITION_LABELS[phase.seal_condition] : null} />
        <Field label="Seal at departure (this leg)" value={departureSeal} mono />
        {findings.map(finding => (
          <div key={finding.key} className={`col-span-2 text-[12px] font-[600] ${FINDING_TONE_CLASS[finding.tone]}`}>
            {finding.text}
          </div>
        ))}
        <EvidencePhoto
          loading={artifactLoading} error={artifactError} onRetry={onRetryArtifacts}
          label="Seal photo as found"
          artifactId={phase.seal_photo_artifact_id}
          artifact={phase.seal_photo_artifact_id ? artifactsById.get(phase.seal_photo_artifact_id) : undefined}
        />
      </Section>

      {hasLocationEvidence(locationEvidenceForPhase(phase, precinct)) && (
        <PhaseLocationSection phase={phase} precinct={precinct} title="Location at arrival" />
      )}

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
