'use client'
import { EvidencePhoto } from '@/components/domain/EvidencePhoto'
import { LocationEvidencePanel } from '@/components/domain/LocationEvidencePanel'
import { locationEvidenceForAssessment } from '@/lib/phase/location-evidence'
import { fmtExceptionType, fmtExceptionRaised } from '@/lib/format/exception'
import type { TripExceptionDetail } from '@shared/lib/types/exception'
interface Props { exception: Pick<TripExceptionDetail, 'gps_lat' | 'gps_lng' | 'action_location_assessment' | 'supporting_artifact_id' | 'supporting_artifact' | 'created_at' | 'exception_type'> }
const LOCATION_TYPES = ['gps_mismatch','driver_location_mismatch','driver_vehicle_separation','trailer_location_mismatch','trailer_separated_in_transit','moved_before_departure','tracker_silent']
export function ExceptionDetailEvidence({ exception }: Props) {
  const assessment = exception.action_location_assessment
  const hasFix = exception.gps_lat !== null && exception.gps_lng !== null
  const hasPhoto = exception.supporting_artifact_id !== null
  return <section aria-label="Recorded evidence" className="mt-6 border-t border-outline-v/30 pt-4 text-sm text-on-surf-v">
    <h2 className="mb-3 text-base font-semibold text-on-surf">Recorded evidence</h2>
    {assessment ? <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>div>div:first-child]:text-xs [&>.col-span-2]:col-span-1 sm:[&>.col-span-2]:col-span-2">
        <LocationEvidencePanel evidence={locationEvidenceForAssessment(assessment, undefined)} contextLabel={fmtExceptionType(exception.exception_type)} />
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <div><dt>Recorded separation limit</dt><dd className="font-semibold tabular-nums">{assessment.max_separation_metres} m</dd></div>
        <div><dt>Driver precinct check</dt><dd>{assessment.driver_in_precinct === null ? 'Unavailable' : assessment.driver_in_precinct ? 'Recorded within precinct' : 'Recorded outside precinct'}</dd></div>
        <div><dt>Recorded assessment</dt><dd className="tabular-nums">{fmtExceptionRaised(assessment.evaluated_at)}</dd></div>
      </dl>
    </> : <>
      {LOCATION_TYPES.includes(exception.exception_type) && <p className="mb-3">Recorded location comparison unavailable. View trip for further evidence.</p>}
      {hasFix && <div className="mb-4"><h3 className="text-xs">Recorded exception location</h3><p className="tabular-nums font-semibold">{exception.gps_lat!.toFixed(5)}, {exception.gps_lng!.toFixed(5)}</p><p className="mt-1 text-xs">Exception raised {fmtExceptionRaised(exception.created_at)}</p></div>}
    </>}
    {hasPhoto ? <div className="mt-4 [&>div>div:first-child]:text-xs"><EvidencePhoto label="Supporting photo" artifact={exception.supporting_artifact ?? undefined} artifactId={exception.supporting_artifact_id} />{exception.supporting_artifact && <p className="mt-2 text-xs tabular-nums">Photo captured {fmtExceptionRaised(exception.supporting_artifact.captured_at)}</p>}</div>
      : (assessment || hasFix) ? <p className="mt-4 text-xs">No supporting photograph recorded.</p> : <p>No supporting photo or location recorded for this exception.</p>}
  </section>
}
