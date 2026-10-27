'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Ic } from '@/components/ui/Ic'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'

type ExceptionEvidenceSource = Pick<
  TripException,
  'gps_lat' | 'gps_lng' | 'supporting_artifact_id' | 'action_location_assessment' | 'supporting_artifacts'
>

interface Props {
  exception: ExceptionEvidenceSource
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
  artifact?: EvidenceArtifactWithUrl
}

/**
 * Whether this exception has anything for the panel below to render.
 *
 * Exported because a caller has to know BEFORE it decides to offer a chevron. The trip
 * timeline used to gate on `artifactsById` being present — but that is a Map from
 * useTripArtifacts and is never absent, so every exception got an expander that opened
 * onto nothing. Essentially every system-raised exception (seal mismatch, parcel count,
 * waybill count) carries no artifact and no fix, so that was most rows on the rail, and
 * it broke the timeline's own rule: a card with no chevron holds nothing to open.
 *
 * One predicate, used by the component and by anyone deciding whether to mount it, so
 * the two cannot drift into disagreeing about what "has evidence" means.
 */
export function exceptionHasEvidence(exception: ExceptionEvidenceSource): boolean {
  const lat = exception.gps_lat
  const lng = exception.gps_lng
  const hasFix = lat !== null && lat !== undefined && lng !== null && lng !== undefined
  const hasPhotoList = (exception.supporting_artifacts?.length ?? 0) > 0
  return exception.supporting_artifact_id !== null || hasPhotoList || hasFix || exception.action_location_assessment != null
}

function EvidencePhotoOrGap({ label, artifact }: { label: string; artifact: EvidenceArtifactWithUrl | undefined }) {
  if (artifact) return <EvidencePhoto label={label} artifact={artifact} />
  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
      <div className="flex items-center gap-[5px] text-[12px] text-warn">
        <Ic n="warn" s={12} className="text-warn" />
        Recorded, could not be retrieved
      </div>
    </div>
  )
}

export function ExceptionEvidence({ exception, artifactsById, artifact: artifactProp }: Props) {
  const artifactId = exception.supporting_artifact_id
  const artifact = artifactProp ?? (artifactId ? artifactsById?.get(artifactId) : undefined)
  const photoIds = (exception.supporting_artifacts ?? []).map(photo => photo.id)

  const lat = exception.gps_lat
  const lng = exception.gps_lng
  const hasFix = lat !== null && lat !== undefined && lng !== null && lng !== undefined
  const assessment = exception.action_location_assessment

  if (!exceptionHasEvidence(exception)) return null

  return (
    <div className="mt-[8px] pt-[8px] border-t border-warn/20 flex flex-wrap items-start gap-5">
      {photoIds.length > 1 ? photoIds.map((id, index) => (
        <EvidencePhotoOrGap key={id} label={`Photo ${index + 1} of ${photoIds.length}`} artifact={artifactsById?.get(id)} />
      )) : artifactId !== null && (
        <EvidencePhotoOrGap label="Supporting photo" artifact={artifact} />
      )}

      {hasFix && (
        <div>
          <div className="text-[10px] text-on-surf-v mb-[1px]">Raised at</div>
          <div className="font-mono text-[12px] tracking-[0.04em] text-on-surf tabular-nums">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </div>
        </div>
      )}

      {assessment && (
        <div>
          <div className="text-[10px] text-on-surf-v mb-[1px]">System comparison</div>
          <div className="text-[12px] text-on-surf">
            {assessment.proximity === 'separated'
              ? 'Driver and vehicle locations were separated'
              : assessment.proximity === 'within_limit'
                ? 'Driver and vehicle locations were within the comparison limit'
                : `Location comparison unverified (${assessment.reasons.join(', ')})`}
          </div>
        </div>
      )}
    </div>
  )
}
