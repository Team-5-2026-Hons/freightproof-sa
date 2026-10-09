import type { PPManifestRef, PPManifestTotals } from '@shared/lib/types/pp-manifest'
import type { TripType } from '@shared/lib/types/trip'

export const EMPTY_LEG_LABEL = 'Empty leg'
export const NO_MANIFEST_LABEL = 'No manifest'

/** What lists and headers call a trip now the order number is gone (spec §12). A loaded
 *  trip can lack a manifest (trips made before FP-281, or through POST /trips with
 *  consignments), so "Empty leg" is said only when the trip type proves it. */
export function manifestLabel(ref: PPManifestRef | null, tripType: TripType | null): string {
  if (ref) return ref.display
  return tripType === 'empty_leg' ? EMPTY_LEG_LABEL : NO_MANIFEST_LABEL
}

/** The manifest's own identifier, "CPT 81", for a narrow column where the full label
 *  ("CGY Logistics · CPT 81") would truncate away the part that tells two trips apart. */
export function manifestKey(ref: PPManifestRef | null, tripType: TripType | null): string {
  return ref ? `${ref.origin_hub} ${ref.number}` : manifestLabel(null, tripType)
}

/** "2 waybills · 5 parcels · 180.5 kg": a manifest's cargo in one line. Weight is left out
 *  where space is short (a collapsed summary, the create panel's rows). */
export function fmtManifestCargo(totals: PPManifestTotals, { withWeight = true }: { withWeight?: boolean } = {}): string {
  const counts = `${totals.waybills} waybills · ${totals.parcels} parcels`
  return withWeight ? `${counts} · ${totals.weight_kg} kg` : counts
}

/** The client half of a manifest's display label ("CGY Logistics" from "CGY Logistics · JNB 69"),
 *  for a cell that stacks it under the key. Null when the ref is absent or its label does not end
 *  in the key, so a cell shows what it can prove rather than a guess at the client. */
export function manifestClient(ref: PPManifestRef | null): string | null {
  if (!ref) return null
  const suffix = ` · ${manifestKey(ref, null)}`
  return ref.display.endsWith(suffix) ? ref.display.slice(0, -suffix.length) : null
}
