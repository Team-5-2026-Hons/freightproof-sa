'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Ic } from '@/components/ui/Ic'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'

// Narrower than TripException so exception-detail's own record satisfies it structurally, no cast needed.
type ExceptionEvidenceSource = Pick<TripException, 'gps_lat' | 'gps_lng' | 'supporting_artifact_id'>

interface Props {
  exception: ExceptionEvidenceSource
  // Built from useTripArtifacts by callers with a trip-wide fetch; use `artifact` instead if not available.
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
  // Passed directly by callers that already hold the one relevant artifact.
  artifact?: EvidenceArtifactWithUrl
}

/** Whether this exception has anything for the panel below to render (a GPS fix or an artifact). */
export function exceptionHasEvidence(exception: ExceptionEvidenceSource): boolean {
  const lat = exception.gps_lat
  const lng = exception.gps_lng
  const hasFix = lat !== null && lat !== undefined && lng !== null && lng !== undefined
  return exception.supporting_artifact_id !== null || hasFix
}

/** Renders what the driver captured when raising this exception (photo and/or GPS fix). */
export function ExceptionEvidence({ exception, artifactsById, artifact: artifactProp }: Props) {
  const artifactId = exception.supporting_artifact_id
  // An explicitly-passed artifact always wins; otherwise fall back to the id/Map lookup.
  const artifact = artifactProp ?? (artifactId ? artifactsById?.get(artifactId) : undefined)

  const lat = exception.gps_lat
  const lng = exception.gps_lng
  const hasFix = lat !== null && lat !== undefined && lng !== null && lng !== undefined

  if (!exceptionHasEvidence(exception)) return null

  return (
    <div className="mt-[8px] pt-[8px] border-t border-warn/20 flex items-start gap-5">
      {/* An id with no resolved artifact means retrieval failed, not that nothing was captured. */}
      {artifactId !== null && (
        artifact
          ? <EvidencePhoto label="Supporting photo" artifact={artifact} />
          : (
            <div>
              <div className="text-[10px] text-on-surf-v mb-[1px]">Supporting photo</div>
              <div className="flex items-center gap-[5px] text-[12px] text-warn">
                <Ic n="warn" s={12} className="text-warn" />
                Recorded, could not be retrieved
              </div>
            </div>
          )
      )}

      {hasFix && (
        <div>
          <div className="text-[10px] text-on-surf-v mb-[1px]">Raised at</div>
          <div className="font-mono text-[12px] tracking-[0.04em] text-on-surf tabular-nums">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </div>
        </div>
      )}
    </div>
  )
}
