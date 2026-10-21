'use client'

import { useState } from 'react'
import type { ExceptionType } from '@shared/lib/types/exception'
import { Button } from '@/components/ui/Button'
import { RecordLink } from '@/components/ui/RecordLink'
import { Select } from '@/components/ui/Select'
import { ApiError } from '@/lib/api/client'
import { appendIncidentUpdate } from '@/lib/api/incidents'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { useTripIncidents } from '@/lib/hooks/useIncidents'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { INCIDENT_TYPE_LABELS, incidentTypeForException } from '@/lib/format/incident'
import { ReportIncidentDialog } from './ReportIncidentDialog'

interface Props {
  exceptionId: string
  tripId: string
  exceptionType: ExceptionType
  description: string
  onNavigate: (href: string) => void
}

/**
 * Where this exception stands in an investigation. Reviewing an exception records one
 * assessment of one observation; an incident is where follow-up happens. An exception joins at
 * most one incident, and joining one never marks it reviewed.
 */
export function ExceptionIncidentPanel({ exceptionId, tripId, exceptionType, description, onNavigate }: Props): React.JSX.Element {
  const { notify } = useToast()
  const { data: incidents, refetchSilent } = useTripIncidents(tripId)
  const { trip } = useTripDetail(tripId)
  const [reportOpen, setReportOpen] = useState(false)
  const holder = incidents.find(i => i.exception_ids.includes(exceptionId))
  const joinable = incidents.filter(i => i.status !== 'closed')
  const [target, setTarget] = useState('')
  const [linking, setLinking] = useState(false)

  async function link(): Promise<void> {
    if (!target) return
    setLinking(true)
    try {
      await appendIncidentUpdate(target, { kind: 'exception_linked', exception_id: exceptionId })
      notify({ kind: 'success', title: 'Added to the incident' })
      refetchSilent()
    } catch (err) {
      notify({ kind: 'error', title: 'Could not add it', body: err instanceof ApiError ? err.message : 'Please try again.' })
    } finally {
      setLinking(false)
    }
  }

  return (
    <section aria-label="Investigation" className="min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest p-4 sm:p-6">
      <h2 className="text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">Investigation</h2>
      {holder ? (
        <p className="mt-3 text-sm">
          Part of <RecordLink href={withReturnTo(ROUTES.incidentDetail(holder.incident_id), ROUTES.exceptionDetail(exceptionId))}>{holder.reference} · {INCIDENT_TYPE_LABELS[holder.incident_type]}</RecordLink>
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-on-surf-v">Not part of an incident. Open one to record follow-up beyond this review.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!trip} onClick={() => setReportOpen(true)}>
              Open {INCIDENT_TYPE_LABELS[incidentTypeForException(exceptionType)].toLowerCase()} incident
            </Button>
          </div>
          {joinable.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <Select label="Or add to an open incident" value={target} onChange={e => setTarget(e.target.value)}>
                  <option value="">Choose an incident</option>
                  {joinable.map(i => <option key={i.incident_id} value={i.incident_id}>{i.reference} · {INCIDENT_TYPE_LABELS[i.incident_type]}</option>)}
                </Select>
              </div>
              <Button size="sm" loading={linking} disabled={!target || linking} onClick={link}>Add</Button>
            </div>
          )}
        </div>
      )}
      {trip && (
        <ReportIncidentDialog trip={trip} open={reportOpen}
          takenExceptionIds={new Set(incidents.flatMap(i => i.exception_ids))}
          prefill={{ incidentType: incidentTypeForException(exceptionType), exceptionIds: [exceptionId], summary: description }}
          onClose={() => setReportOpen(false)}
          onReported={incident => { setReportOpen(false); onNavigate(withReturnTo(ROUTES.incidentDetail(incident.incident_id), ROUTES.exceptionDetail(exceptionId))) }} />
      )}
    </section>
  )
}
