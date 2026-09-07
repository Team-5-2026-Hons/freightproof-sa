'use client'

import { EvidencePhoto } from './EvidencePhoto'
import { Ic } from '@/components/ui/Ic'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { TripException } from '@shared/lib/types/exception'

// Minimal shape both this component and its predicate actually read. Narrower than the
// full TripException so the exception-detail page's TripExceptionDetail record — which
// carries these same three fields, all non-optionally — satisfies this structurally with
// no cast, and without that page having to fabricate an artifactsById Map it has no use
// for (it already has the one relevant artifact in hand).
type ExceptionEvidenceSource = Pick<TripException, 'gps_lat' | 'gps_lng' | 'supporting_artifact_id'>

interface Props {
  exception: ExceptionEvidenceSource
  // Optional: the trip timeline and trip-detail page build this from useTripArtifacts
  // (a trip-wide fetch); the exception-detail page has no such Map and passes `artifact`
  // instead. Not required together — see the resolution order below.
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
  // Optional: a caller that already holds the one artifact this exception could
  // reference (the exception-detail page, from its own GET's nested `supporting_artifact`)
  // passes it directly rather than standing up a one-entry Map.
  artifact?: EvidenceArtifactWithUrl
}

/**
 * What the driver actually captured when they raised this exception.
 *
 * The backend has always sent `supporting_artifact_id` and the GPS fix, and the timeline
 * rendered the description text alone — so a `cargo_damage` raised with a photograph, or
 * a panic button carrying the coordinates it was pressed at, reached the dispatcher as a
 * sentence. Renders nothing when the exception carries neither.
 */
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
  return exception.supporting_artifact_id !== null || hasFix
}

export function ExceptionEvidence({ exception, artifactsById, artifact: artifactProp }: Props) {
  const artifactId = exception.supporting_artifact_id
  // An explicitly-passed artifact always wins. There is no case where a caller passes
  // `artifact` AND needs the Map fallback: TripExceptionDetail's supporting_artifact and
  // supporting_artifact_id are always in lockstep (both null, or both set), so when
  // `artifact` is undefined here it is because there genuinely is none — falling through
  // to the id/Map lookup is exactly what the two Map-based callers still need.
  const artifact = artifactProp ?? (artifactId ? artifactsById?.get(artifactId) : undefined)

  const lat = exception.gps_lat
  const lng = exception.gps_lng
  const hasFix = lat !== null && lat !== undefined && lng !== null && lng !== undefined

  if (!exceptionHasEvidence(exception)) return null

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
