// The at-a-glance figures and the journey strip's break point, shared by the page header and the
// Summary section. The PDF cover (backend audit_pack.html.j2) states the same figures the same
// way, so both copies of one pack open on the same numbers.
import { compareInstants } from './timeline'
import type { AuditPackManifest } from './types'

export interface CargoTotals {
  /** Sum of the declared values, as a decimal string for formatRand; null when none was declared. */
  declaredValue: string | null
  /** Consignments that carried a declared value: fewer than `consignments` means the sum is partial. */
  valued: number
  consignments: number
  parcels: number
}

export function cargoTotals(manifest: AuditPackManifest): CargoTotals {
  const valued = manifest.consignments.filter((c) => c.declared_value != null)
  // Summed in cents so R 0.10 + R 0.20 prints as R 0.30, not R 0.30000000000000004.
  const cents = valued.reduce((total, c) => total + Math.round(Number(c.declared_value) * 100), 0)
  return {
    declaredValue: valued.length > 0 ? (cents / 100).toFixed(2) : null,
    valued: valued.length,
    consignments: manifest.consignments.length,
    parcels: manifest.consignments.reduce((total, c) => total + c.parcels.length, 0),
  }
}

/**
 * The sequence number of the last phase completed at or before the incident was first raised,
 * or null when there is no incident or it came before any phase was completed.
 *
 * An ordering fact from the ledger, not a claim about where the vehicle was: the strip draws its
 * break after this phase and says so in words.
 */
export function incidentBreakAfter(manifest: AuditPackManifest): number | null {
  const incident = manifest.incident
  if (!incident) return null
  let after: number | null = null
  for (const phase of manifest.phases) {
    if (phase.completed_at && compareInstants(phase.completed_at, incident.first_raised_at) <= 0) {
      after = phase.sequence_number
    }
  }
  return after
}
