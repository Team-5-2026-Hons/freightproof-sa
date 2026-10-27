'use client'

import { formatCoord, formatSast, humanise } from '@/lib/format'
import type { TimelineItem } from '@/lib/timeline'
import type { EvidenceFile, ExceptionPhoto, LocationAssessment } from '@/lib/types'
import { Field } from './Card'
import { ExceptionAnchorList } from './ExceptionAnchorList'
import { EvidencePhoto } from './EvidencePhoto'
import { TierBadge } from './TierBadge'

function photoFile(photo: ExceptionPhoto): EvidenceFile {
  return {
    artifact_id: photo.artifact_id, role: 'exception_supporting', sha256: photo.sha256,
    mime_type: photo.mime_type, captured_at: photo.captured_at, tier: photo.tier,
  }
}

function LocationCheck({ assessment }: { assessment: LocationAssessment }) {
  const reasons = assessment.reasons ?? []
  return (
    <Field label="Location check">
      {humanise(assessment.proximity)}
      {assessment.separation_metres != null && ` · ${Math.round(assessment.separation_metres)} m apart`}
      {assessment.driver_in_precinct != null && ` · driver ${assessment.driver_in_precinct ? 'inside' : 'outside'} precinct`}
      {assessment.truck_in_precinct != null && ` · truck ${assessment.truck_in_precinct ? 'inside' : 'outside'} precinct`}
      {reasons.length > 0 && (
        <span className="block text-meta text-muted">{reasons.map(humanise).join('; ')}</span>
      )}
    </Field>
  )
}

export function EventDetail({ token, item }: { token: string; item: TimelineItem | null }) {
  if (!item) {
    return <p className="text-small text-muted">Select an event on the timeline to see its evidence.</p>
  }
  const evidence = item.record.evidence

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-lead font-extrabold">{item.title}</h3>
        <TierBadge tier={item.tier} />
      </div>
      {item.anchorWarning && (
        <p role="alert" className="mb-2 text-small font-semibold text-err">
          One or more anchored fields differ from Hedera; the Anchored badge is withheld.
        </p>
      )}
      <dl>
        {item.kind === 'phase' && (
          <>
            <Field label="Status">
              {humanise(item.record.status)}
              {item.record.overridden_by_dispatcher && (
                <span className="font-semibold text-err"> · dispatcher override{item.record.override_note ? `: ${item.record.override_note}` : ''}</span>
              )}
            </Field>
            <Field label="Completed"><span className="num">{formatSast(item.record.completed_at)}</span></Field>
            {item.record.slot_time && <Field label="Slot"><span className="num">{formatSast(item.record.slot_time)}</span></Field>}
            {item.record.driver_phone && <Field label="Driver phone"><span className="num">{formatCoord(item.record.driver_phone)}</span></Field>}
            {item.record.vehicle_tracker && <Field label="Vehicle tracker"><span className="num">{formatCoord(item.record.vehicle_tracker)}</span></Field>}
            {item.record.location_assessment && <LocationCheck assessment={item.record.location_assessment} />}
            {item.record.location_warning_acknowledged_at && (
              <Field label="Location warning acknowledged">
                {formatSast(item.record.location_warning_acknowledged_at)}
                {item.record.location_warning_reason && `: ${item.record.location_warning_reason}`}
              </Field>
            )}
            {item.record.seal_number && <Field label="Seal number"><span className="num font-bold">{item.record.seal_number}</span></Field>}
            {item.record.seal_condition && (
              <Field label="Seal condition">
                <span className={item.record.seal_condition === 'intact' ? 'font-semibold text-ok' : 'font-semibold text-err'}>
                  {humanise(item.record.seal_condition)}
                </span>
              </Field>
            )}
            {item.record.parcel_count_origin != null && <Field label="Parcels scanned out"><span className="num">{item.record.parcel_count_origin}</span></Field>}
            {item.record.parcel_count_destination != null && <Field label="Parcels scanned in"><span className="num">{item.record.parcel_count_destination}</span></Field>}
            {item.record.driver_visual_count != null && <Field label="Driver's count"><span className="num">{item.record.driver_visual_count}</span></Field>}
            {item.record.anchored_fields.map((f) => (
              <Field key={f.name} label={`Anchored ${humanise(f.name)}`}>
                <span className={f.matches_anchor ? 'font-semibold text-ok' : 'font-semibold text-err'}>
                  {f.matches_anchor ? 'matches Hedera' : 'differs from Hedera'}
                </span>
              </Field>
            ))}
            <Field label="Anchor">{humanise(item.record.anchor_status)}</Field>
          </>
        )}
        {item.kind === 'checkpoint' && (
          <>
            <Field label="Recorded"><span className="num">{formatSast(item.record.recorded_at)}</span></Field>
            <Field label="Driver phone"><span className="num">{formatCoord(item.record.driver_phone)}</span></Field>
            <Field label="Deviation">{item.record.is_deviation ? 'Yes' : 'No'}</Field>
            {item.record.note && <Field label="Note">{item.record.note}</Field>}
          </>
        )}
        {item.kind === 'exception' && (
          <>
            <Field label="Raised"><span className="num">{formatSast(item.record.raised_at)}</span></Field>
            <Field label="Severity / source">{humanise(item.record.severity)} · {humanise(item.record.source)}</Field>
            <Field label="Description">{item.record.description}</Field>
            <Field label="Position">
              <span className="num">{formatCoord(item.record.position)}</span>
              {item.record.position && <span className="text-muted"> · Recorded — GPS is never part of a receipt</span>}
            </Field>
            <Field label="Review">
              {humanise(item.record.review_status)}
              {item.record.reviewed_at && `, ${formatSast(item.record.reviewed_at)}`}
              {item.record.reviewer_name && ` by ${item.record.reviewer_name}`}
              {item.record.contact_method && ` via ${item.record.contact_method}`}
              {item.record.review_outcome && ` · ${humanise(item.record.review_outcome)}`}
            </Field>
            {item.record.review_note && <Field label="Review note">{item.record.review_note}</Field>}
          </>
        )}
      </dl>
      {item.kind === 'exception' && <ExceptionAnchorList anchors={item.record.anchors ?? []} />}
      {item.kind === 'exception' && item.record.photos && item.record.photos.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {item.record.photos.map((photo, index, all) => (
            <EvidencePhoto
              key={photo.artifact_id} token={token} file={photoFile(photo)}
              label={all.length > 1 ? `Photo ${index + 1} of ${all.length}` : 'Photo'}
              receiptId={photo.anchor_receipt_id}
            />
          ))}
        </div>
      ) : evidence.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {evidence.map((file) => <EvidencePhoto key={file.artifact_id} token={token} file={file} />)}
        </div>
      )}
    </div>
  )
}
