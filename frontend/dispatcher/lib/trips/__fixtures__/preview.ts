// Test-only builders for PP manifest previews (FP-281). No .test suffix, so Vitest never
// collects this file. The client and precincts are the shared mocks' Courier Guy ones, so
// a page test's precinct list contains the client's depots.

import { CGY_ORG_ID } from '@shared/lib/mocks/principals'
import { PRECINCT_CGY_CT_ID, PRECINCT_CGY_JHB_ID } from '@shared/lib/mocks/precincts'
import type {
  PPManifestPreview, PPManifestWarning, PPManifestWarningCode,
} from '@shared/lib/types/pp-manifest'

const BLOCKING_CODES: readonly PPManifestWarningCode[] = [
  'MANIFEST_ALREADY_ON_TRIP', 'CLIENT_NOT_LINKED', 'WAYBILL_CLIENT_MISMATCH',
  'WAYBILL_ON_OTHER_TRIP', 'NO_WAYBILLS',
]

export const CLIENT_ID: string = CGY_ORG_ID
export const ORIGIN_ID: string = PRECINCT_CGY_CT_ID
export const DESTINATION_ID: string = PRECINCT_CGY_JHB_ID

export function makeWarning(
  code: PPManifestWarningCode,
  overrides: Partial<PPManifestWarning> = {},
): PPManifestWarning {
  return {
    code,
    message: `${code} message`,
    blocking: BLOCKING_CODES.includes(code),
    trip_id: null,
    trip_reference: null,
    waybills: [],
    ...overrides,
  }
}

export function makePreview(overrides: Partial<PPManifestPreview> = {}): PPManifestPreview {
  return {
    pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 81, display: 'The Courier Guy · CPT 81' },
    snapshot_sha256: 'a'.repeat(64),
    client_organization_id: CLIENT_ID,
    client_name: 'The Courier Guy',
    origin: { hub_code: 'CPT', precinct_id: ORIGIN_ID, precinct_name: 'Courier Guy CT, Montague Gardens' },
    destination: { hub_code: 'JNB', precinct_id: DESTINATION_ID, precinct_name: 'Courier Guy JHB, Linbro Park' },
    planned_departure_at: '2026-10-02T16:00:00Z',
    expected_arrival_at: '2026-10-03T04:00:00Z',
    is_closed: true,
    client_reference: 'PO-CGY-0081',
    notes: [{ noted_at: '2026-10-02T14:25:00Z', operator: 'CGY Dispatch', text: 'Two pallets shrink-wrapped together' }],
    totals: { waybills: 2, parcels: 5, weight_kg: 180.5 },
    waybills: [
      { waybill: 'MFTWB8101', destination_town: 'Johannesburg', parcel_count: 3, weight_kg: 120 },
      { waybill: 'MFTWB8102', destination_town: 'Midrand', parcel_count: 2, weight_kg: 60.5 },
    ],
    warnings: [],
    can_create: true,
    ...overrides,
  }
}
