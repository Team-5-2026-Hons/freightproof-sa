import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { ChipType } from '@shared/lib/constants/status-meta'
import type { TripStatus } from '@shared/lib/types/trip'
import type { ChipKind } from '@/components/ui/Chip'

// Translates status-meta's domain-level ChipType vocabulary into driver-pwa's
// Chip component visual ChipKind vocabulary — the two unions are intentionally
// different (one describes domain meaning, the other describes chip styling).
// Keyed by ChipType (not string) so the compiler forces an explicit mapping
// decision whenever a new ChipType member is added.
const CHIP_TYPE_TO_KIND: Record<ChipType, ChipKind> = {
  pending:   'pending',
  transit:   'info',
  loading:   'info',
  complete:  'success',
  exception: 'warning',
  critical:  'error',
}

export function tripStatusChip(status: TripStatus): { kind: ChipKind; label: string } {
  const meta = TRIP_STATUS_META[status]
  return { kind: CHIP_TYPE_TO_KIND[meta.chipType], label: meta.label }
}
