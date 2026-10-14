'use client'

import { useId, useState } from 'react'
import { EVIDENCE_ROLE_NOUN } from '@shared/lib/constants/phase-meta'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseType } from '@shared/lib/types/phase'
import { countLabel } from '@/lib/format/count'
import { evidenceStateLabel, evidenceTimeLines, evidenceTitle } from '@/lib/phase/act-wording'
import type { EvidenceAct } from '@/lib/phase/acts'
import type { EvidenceGroup } from '@/lib/phase/act-groups'
import { EvidenceDocument } from './EvidenceDocument'
import { EvidencePhoto } from './EvidencePhoto'
import { NumericText } from './NumericText'

/** How the page resolved this trip's artifacts: the rows read their image and metadata from it,
 *  and surface its loading and failure states themselves. */
export interface EvidenceLookup {
  artifactsById: ReadonlyMap<string, EvidenceArtifactWithUrl>
  artifactLoading: boolean
  artifactError: string | null
  onRetryArtifacts: () => void
}

interface Props {
  group: EvidenceGroup
  phaseType: PhaseType
  lookup: EvidenceLookup
}

const VISIBLE_WHEN_COLLAPSED = 1

/** "seal photo" -> "Seal photo": the image's own caption, kept apart from the row's headline so
 *  the two never read as the same sentence twice. */
function captionFor(role: EvidenceAct['role'], index: number, total: number): string {
  const noun = EVIDENCE_ROLE_NOUN[role]
  const label = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`
  return total > 1 ? `${label} ${index + 1} of ${total}` : label
}

function uploadedHeading(group: EvidenceGroup): string {
  return `${countLabel(group.acts.length, group.role === 'pod_signature' ? 'file' : 'photo')} uploaded`
}

function EvidenceImage({ act, caption, lookup }: { act: EvidenceAct; caption: string; lookup: EvidenceLookup }) {
  const artifact = lookup.artifactsById.get(act.artifactId)
  const common = {
    label: caption,
    artifactId: act.artifactId,
    artifact,
    loading: lookup.artifactLoading,
    error: lookup.artifactError,
    onRetry: lookup.onRetryArtifacts,
  }
  // The receiver's attestation is a document; every other role is a photograph.
  return act.role === 'pod_signature' ? <EvidenceDocument {...common} /> : <EvidencePhoto {...common} size="compact" />
}

function EvidenceActBlock({ act, caption, lookup }: { act: EvidenceAct; caption: string; lookup: EvidenceLookup }) {
  return (
    <div className="flex flex-wrap items-start gap-3 pt-1.5">
      {/* Regular weight: the title above is the headline, and its state and times are detail
          that must not compete with it. */}
      <div className="min-w-0">
        <p className="text-meta text-on-surf-v">{evidenceStateLabel(act)}</p>
        {evidenceTimeLines(act).map(line => (
          <p key={line} className="text-meta tabular-nums tracking-[0.03em] text-on-surf-v">{line}</p>
        ))}
      </div>
      <div className="min-w-0 max-w-full"><EvidenceImage act={act} caption={caption} lookup={lookup} /></div>
    </div>
  )
}

/**
 * One role's evidence on the rail. A single upload reads as one row; several (a driver
 * retaking a photo) read as one group headed "{n} photos uploaded", with the copy the phase
 * submitted first and the rest behind "+{n − 1} more", so the count is never lost and the
 * rail is never flooded.
 */
export function EvidenceGroupRow({ group, phaseType, lookup }: Props) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const total = group.acts.length
  const visible = expanded ? group.acts : group.acts.slice(0, VISIBLE_WHEN_COLLAPSED)
  const hidden = total - VISIBLE_WHEN_COLLAPSED
  return (
    <div>
      <p className="text-body font-semibold text-on-surf">{evidenceTitle(group.acts[0]!, phaseType)}</p>
      {total > 1 && <p className="text-meta text-on-surf-v"><NumericText text={uploadedHeading(group)} /></p>}
      <div id={listId}>
        {visible.map(act => (
          <EvidenceActBlock key={act.key} act={act} caption={captionFor(act.role, group.acts.indexOf(act), total)} lookup={lookup} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={expanded ? 'Show fewer' : `+${hidden} more`}
          onClick={() => setExpanded(value => !value)}
          className="mt-1 min-h-11 text-meta font-semibold text-sec underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec"
        >
          {expanded ? 'Show fewer' : <NumericText text={`+${hidden} more`} />}
        </button>
      )}
    </div>
  )
}
