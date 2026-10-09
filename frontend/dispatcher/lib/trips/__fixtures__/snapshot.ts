// Test-only H0 snapshot, shaped like the backend's PPManifestSnapshotRead.
// Two waybills, three parcels, 180.5 kg.
import type { PPManifestSnapshot } from '@shared/lib/types/pp-manifest'

export function makeSnapshot(): PPManifestSnapshot {
  return {
    manifest_number: 81,
    issuer_account: 'MOCK01',
    issuer_name: 'CGY Logistics',
    origin_hub: 'CPT',
    destination_hub: 'JNB',
    client_reference: 'PO-CGY-0081',
    waybills: [
      { waybill: 'MFTWB8101', destination_town: 'Johannesburg', parcel_count: 2, weight_kg: 120 },
      { waybill: 'MFTWB8102', destination_town: 'Midrand', parcel_count: 1, weight_kg: 60.5 },
    ],
    totals: { waybills: 2, parcels: 3, weight_kg: 180.5 },
  }
}
