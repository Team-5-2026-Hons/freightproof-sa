'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Ic } from '@/components/ui/Ic'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  exception: TripException
  artifactsById: Map<string, EvidenceArtifactWithUrl>
}

/**
 * What the driver actually captured when they raised this exception.
 *
 * The backend has always sent `supporting_artifact_id` and the GPS fix, and the timeline
 * rendered the description text alone — so a `cargo_damage` raised with a photograph, or
 * a panic button carrying the coordinates it was pressed at, reached the dispatcher as a
 * sentence. Renders nothing when the exception carries neither.
 */
export function ExceptionEvidence({ exception, artifactsById }: Props) {
  const artifactId = exception.supporting_artifact_id
  const artifact   = artifactId ? artifactsById.get(artifactId) : undefined

  const lat = exception.gps_lat
  const lng = exception.gps_lng
  const hasFix = lat !== null && lat !== undefined && lng !== null && lng !== undefined

  if (artifactId === null && !hasFix) return null

  return (
    <div className="mt-[8px] pt-[8px] border-t border-warn/20 flex items-start gap-5">
      {/* Three states, kept apart. An id with no artifact behind it is NOT "nothing was
          captured" — the record says a photo exists and we could not retrieve it, which
          is a retrieval failure the dispatcher has to be able to see. */}
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
