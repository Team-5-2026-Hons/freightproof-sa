import type { DateRange } from '@/lib/types/date-range'

interface SLAMetrics {
  onTimePickupPct: number
  onTimeDeliveryPct: number
  handshakeCompletionPct: number
  exceptionsByType: Record<string, number>
}

// Phase 1 stub — returns null until the SLA metrics API endpoint is wired up.
export function useSLAMetrics(_filter: { range: DateRange }): SLAMetrics | null {
  return null
}
