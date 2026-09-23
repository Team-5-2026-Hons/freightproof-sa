'use client'

import { formatCoord, formatSast, humanise } from '@/lib/format'
import type { TimelineItem } from '@/lib/timeline'
import { Field } from './Card'
import { EvidencePhoto } from './EvidencePhoto'
import { TierBadge } from './TierBadge'

export function EventDetail({ token, item }: { token: string; item: TimelineItem | null }) {
  if (!item) {
    return <p className="text-[13px] text-muted">Select an event on the timeline to see its evidence.</p>
  }
  const evidence = item.record.evidence

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-extrabold">{item.title}</h3>
        <TierBadge tier={item.tier} />
      </div>
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
            {item.record.location_assessment && (
              <Field label="Location check">
                {humanise(item.record.location_assessment.proximity)}
                {item.record.location_assessment.separation_metres != null && ` · ${Math.round(item.record.location_assessment.separation_metres)} m apart`}
                {item.record.location_assessment.driver_in_precinct != null && ` · driver ${item.record.location_assessment.driver_in_precinct ? 'inside' : 'outside'} precinct`}
              </Field>
            )}
            {item.record.location_warning_acknowledged_at && (
              <Field label="Location warning acknowledged">
                {formatSast(item.record.location_warning_acknowledged_at)}
                {item.record.location_warning_reason && `: ${item.record.location_warning_reason}`}
              </Field>
            )}
            {item.record.seal_number && <Field label="Seal number"><span className="num font-bold">{item.record.seal_number}</span></Field>}
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
            <Field label="Position"><span className="num">{formatCoord(item.record.position)}</span></Field>
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
      {evidence.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {evidence.map((file) => <EvidencePhoto key={file.artifact_id} token={token} file={file} />)}
        </div>
      )}
    </div>
  )
}
