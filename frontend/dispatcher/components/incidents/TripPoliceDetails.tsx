'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { InfoRow } from '@/components/ui/InfoRow'
import { ApiError } from '@/lib/api/client'
import { incidentSheetPdf, listIncidentDeclarations, saveBlob } from '@/lib/api/auditPacks'
import { useAsyncData } from '@/lib/hooks/useAsyncData'
import { useToast } from '@/lib/hooks/useToast'
import type { IncidentDeclaration } from '@/lib/types/auditPack'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { SectionRowsSkeleton } from './IncidentSkeletons'

interface Props {
  tripId: string
  tripReference: string
  /** Opens the record-police-details dialog. The dialog belongs to the panel, not here: below the
   *  dock width this renders inside DetailPanel's own overlay <dialog>. */
  onDeclare: () => void
  /** Whether to offer the section on a trip with nothing recorded yet: when it has an incident or a
   *  critical exception. With neither, and nothing already recorded, this renders nothing. */
  showSection: boolean
  /** Whether the server can build the fact sheet: it needs a critical exception or a recorded
   *  hijacking (summarise_incident), so the button is offered only then. */
  canBuildSheet: boolean
  /** Bumped by the caller after a declaration is saved, so the list is read again in place. */
  refreshKey?: number
}

/**
 * What a dispatcher has recorded about the police and who was told, for an incident on this
 * trip. It sits under the Incidents section because the SAPS case number and station are facts
 * of an incident, and an insurer's first questions about one.
 */
export function TripPoliceDetails({ tripId, tripReference, onDeclare, showSection, canBuildSheet, refreshKey = 0 }: Props): React.JSX.Element | null {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const fetchDeclarations = useCallback(() => listIncidentDeclarations(tripId), [tripId])
  const declarations = useAsyncData<IncidentDeclaration[]>(fetchDeclarations, [])
  const { refetchSilent } = declarations
  // Read again in place, without the skeleton: the list stays on screen and the page does not jump.
  useEffect(() => {
    if (refreshKey > 0) refetchSilent()
  }, [refreshKey, refetchSilent])

  async function downloadSheet(): Promise<void> {
    setBusy(true)
    try {
      saveBlob(await incidentSheetPdf(tripId), `${tripReference}-incident-sheet.pdf`)
    } catch (err) {
      notify({ kind: 'error', title: err instanceof ApiError && err.status === 403 ? 'Admin dispatcher role required.' : err instanceof ApiError && err.status === 409 ? err.message : 'Could not build the fact sheet.' })
    } finally {
      setBusy(false)
    }
  }

  const loading = declarations.isLoading && declarations.data.length === 0
  const recorded = declarations.data.length > 0
  if (!showSection && !recorded) return null
  return (
    <section aria-label="Police and notifications" className="mt-4 flex flex-col gap-1 border-t border-outline-v/40 pt-4">
      <h4 className="text-[13px] font-bold text-on-surf">Police &amp; notifications</h4>
      {loading && <SectionRowsSkeleton rows={1} label="Loading police details" />}
      {declarations.error && <p role="status" className="text-[13px] text-err">{declarations.error}</p>}
      {!loading && !declarations.error && !recorded && <InfoRow label="SAPS case no." value="Not recorded" />}
      {declarations.data.map(d => (
        <div key={d.declaration_id}>
          {d.saps_cas_number ? <InfoRow label="SAPS case no." value={`CAS ${d.saps_cas_number}`} mono /> : <InfoRow label="Notification times" value="Declared" />}
          {d.saps_station && <InfoRow label="SAPS station" value={d.saps_station} />}
          <p className="py-1 text-[11px] text-on-surf-v">Declared {fmtDateTime(d.declared_at)}{d.declared_by_name ? ` by ${d.declared_by_name}` : ''}</p>
        </div>
      ))}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onDeclare}>Record police details</Button>
        {canBuildSheet && <Button size="sm" variant="ghost" loading={busy} onClick={downloadSheet}>Incident fact sheet</Button>}
      </div>
    </section>
  )
}
