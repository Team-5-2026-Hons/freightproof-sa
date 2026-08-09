import type { DateRange } from '@/lib/types/date-range'

interface SLAMetrics {
  onTimePickupPct: number
  onTimeDeliveryPct: number
  // Renamed to reflect the phase-based model. Still a stub — when this is
  // really implemented its denominator must be each trip's OWN plan length
  // (see lib/phase/derive.ts completionPct), never a fixed count of steps.
  phaseCompletionPct: number
  exceptionsByType: Record<string, number>
}

// Phase 1 stub — returns null until the SLA metrics API endpoint is wired up.
export function useSLAMetrics(_filter: { range: DateRange }): SLAMetrics | null {
  return null
}
