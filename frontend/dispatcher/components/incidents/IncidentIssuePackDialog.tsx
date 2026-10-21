'use client'

import { IssueAuditPackDialog } from '@/components/domain/IssueAuditPackDialog'
import { useTripDetail } from '@/lib/hooks/useTripDetail'

interface Props {
  tripId: string
  onClose: () => void
  onIssued: () => void
}

/**
 * Issue the insurer pack without leaving the incident. The pack dialog needs the trip's
 * consignments (for scoping a pack to one client), which the incident read does not carry,
 * so the trip is loaded here — only once the dispatcher opens it, never on every page view.
 */
export function IncidentIssuePackDialog({ tripId, onClose, onIssued }: Props): React.JSX.Element | null {
  const { trip } = useTripDetail(tripId)
  if (!trip) return null
  return <IssueAuditPackDialog tripId={tripId} consignments={trip.consignments} open onClose={onClose} onIssued={onIssued} />
}
