import { fmtExceptionType } from '@/lib/format/exception'
import type { DevConsignment, PpTriggerRequest, RoadCheckResponse } from '@/lib/types/dev'

export type ScanPreset = 'all' | 'one_short' | 'stray'
export type PpPreset = 'delivered' | 'delivery_failed' | 'parcel_added'

// Deterministic, so pressing "stray parcel" twice stages the same scan: MockScanFeed
// REPLACES staged barcodes rather than appending, and a new random stray each press would
// read as a second stranger parcel.
export const STRAY_BARCODE_SUFFIX = '-STRAY'
export const DEMO_FAILURE_REASON = 'Receiver not available'

/** Every waybill's barcodes for the preset. The whole map is always sent: a waybill
 *  absent from it would stage an EMPTY scan (see ScanTriggerRequest). The preset's
 *  change applies to the first waybill only, so the demo shows one clear discrepancy. */
export function barcodesForPreset(consignments: readonly DevConsignment[], preset: ScanPreset): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  consignments.forEach((consignment, index) => {
    const barcodes = [...consignment.barcodes]
    const target = index === 0
    if (target && preset === 'one_short') barcodes.pop()
    if (target && preset === 'stray') barcodes.push(`${consignment.parcel_perfect_reference}${STRAY_BARCODE_SUFFIX}`)
    result[consignment.parcel_perfect_reference] = barcodes
  })
  return result
}

/** dd/mm/yyyy — the format Parcel Perfect itself returns for a POD date. */
export function ppDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(now.getUTCDate())}/${pad(now.getUTCMonth() + 1)}/${now.getUTCFullYear()}`
}

export function ppRequestForPreset(tripId: string, consignment: DevConsignment, preset: PpPreset, now: Date): PpTriggerRequest {
  const base = { trip_id: tripId, parcel_perfect_reference: consignment.parcel_perfect_reference }
  if (preset === 'delivered') return { ...base, poddate: ppDate(now) }
  if (preset === 'delivery_failed') return { ...base, failtype: DEMO_FAILURE_REASON }
  // One more parcel than the manifest: the verified mid-trip PP edit (spec §B2c).
  return { ...base, parcel_count: consignment.barcodes.length + 1 }
}

/** One line for the activity log: what the road check newly recorded, or why it did not run. */
export function describeRoadCheck(result: RoadCheckResponse): string {
  if (result.skipped_reason !== null) return `Tracker check skipped: ${result.skipped_reason}`
  const fresh = result.findings.filter(f => f.newly_recorded)
  if (fresh.length === 0) return 'Tracker check: nothing new.'
  const names = fresh.map(f => fmtExceptionType(f.exception_type)).join(', ')
  return `Tracker check: ${fresh.length} new finding${fresh.length === 1 ? '' : 's'} (${names}).`
}
