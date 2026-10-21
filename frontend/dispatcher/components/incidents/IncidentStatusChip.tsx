import { Chip, type ChipType } from '@/components/ui/Chip'
import { INCIDENT_STATUS_LABELS } from '@/lib/format/incident'
import type { IncidentStatus } from '@/lib/types/incident'

// Open is the one that asks for action, so it takes the warning fill; closed reads as done.
export const INCIDENT_STATUS_CHIP: Record<IncidentStatus, ChipType> = {
  open: 'exception',
  investigating: 'transit',
  closed: 'complete',
}

export function IncidentStatusChip({ status }: { status: IncidentStatus }): React.JSX.Element {
  return <Chip type={INCIDENT_STATUS_CHIP[status]} label={INCIDENT_STATUS_LABELS[status]} />
}
