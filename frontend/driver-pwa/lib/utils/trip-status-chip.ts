import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { ChipType } from '@shared/lib/constants/status-meta'
import type { TripStatus } from '@shared/lib/types/trip'
import type { ChipKind } from '@/components/ui/Chip'

// Translates status-meta's domain-level ChipType vocabulary into driver-pwa's
// Chip component visual ChipKind vocabulary — the two unions are intentionally
// different (one describes domain meaning, the other describes chip styling).
// Keyed by ChipType (not string) so the compiler forces an explicit mapping
// decision whenever a new ChipType member is added.
//
// `transit`/`loading` → 'live' (green, pulsing) rather than the design system's blue.
// Both domain types mean "this is happening right now", and today only `transit` is
// reachable here — TRIP_STATUS_META has no `loading` member, so the one status this
// actually repaints is `active`: the driver's own trip, in progress. Blue is the app's
// informational hue and reads as inert beside every other blue affordance on the
// screen; a running trip is the single piece of live state a driver has and has to be
// legible as such from arm's length in a cab. Phase-level chips are unaffected — they
// resolve through PHASE_STATUS_META, not this function.
const CHIP_TYPE_TO_KIND: Record<ChipType, ChipKind> = {
  pending:   'pending',
  transit:   'live',
  loading:   'live',
  complete:  'success',
  exception: 'warning',
  critical:  'error',
}

export function tripStatusChip(status: TripStatus): { kind: ChipKind; label: string } {
  const meta = TRIP_STATUS_META[status]
  return { kind: CHIP_TYPE_TO_KIND[meta.chipType], label: meta.label }
}
