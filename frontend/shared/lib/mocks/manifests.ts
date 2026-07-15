import type { Manifest, ConsignmentManifest, ParcelId, Parcel, ParcelStatus } from '@shared/lib/types/manifest'
import { TRIP_0040_ID, TRIP_0041_ID, TRIP_0042_ID } from './trips'
import { FEDEX_ORG_ID } from './principals'

const parcelId = (v: string): ParcelId => v as unknown as ParcelId

function parcel(
  id: string,
  barcode: string,
  consignmentId: string,
  stop: string,
  status: ParcelStatus = 'scanned_out',
  scanOutAt = '2026-05-09T07:00:00Z',
): Parcel {
  return {
    id: parcelId(id),
    consignment_id: consignmentId,
    barcode,
    description: null,
    delivery_stop: stop,
    status,
    pp_scan_out_at: scanOutAt,
    pp_scan_in_at: null,
    created_at: '2026-05-09T06:30:00Z',
    updated_at: scanOutAt,
  }
}

// ─── TRP-2026-0041 · 27 parcels · FedEx JHB → DBN (canonical) ────────────────

const CONSIGNMENT_0041 = 'cons-pp-2026-0041'

const CONSIGNMENT_MANIFEST_0041: ConsignmentManifest = {
  consignment_id: CONSIGNMENT_0041,
  parcel_perfect_reference: 'PP-2026-FX-0041',
  client_organization_id: FEDEX_ORG_ID,
  unit_count_expected: 3,
  total_parcel_count: 27,
  origin_scan_complete: true,
  stops: [
    {
      delivery_stop: 'Pinetown, Durban',
      parcel_count: 8,
      parcels: [
        parcel('p041-01', 'FX-0041-001', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-02', 'FX-0041-002', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-03', 'FX-0041-003', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-04', 'FX-0041-004', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-05', 'FX-0041-005', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-06', 'FX-0041-006', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-07', 'FX-0041-007', CONSIGNMENT_0041, 'Pinetown, Durban'),
        parcel('p041-08', 'FX-0041-008', CONSIGNMENT_0041, 'Pinetown, Durban'),
      ],
    },
    {
      delivery_stop: 'Westville, Durban',
      parcel_count: 12,
      parcels: [
        parcel('p041-09', 'FX-0041-009', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-10', 'FX-0041-010', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-11', 'FX-0041-011', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-12', 'FX-0041-012', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-13', 'FX-0041-013', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-14', 'FX-0041-014', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-15', 'FX-0041-015', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-16', 'FX-0041-016', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-17', 'FX-0041-017', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-18', 'FX-0041-018', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-19', 'FX-0041-019', CONSIGNMENT_0041, 'Westville, Durban'),
        parcel('p041-20', 'FX-0041-020', CONSIGNMENT_0041, 'Westville, Durban'),
      ],
    },
    {
      delivery_stop: 'Berea, Durban',
      parcel_count: 7,
      parcels: [
        parcel('p041-21', 'FX-0041-021', CONSIGNMENT_0041, 'Berea, Durban'),
        parcel('p041-22', 'FX-0041-022', CONSIGNMENT_0041, 'Berea, Durban'),
        parcel('p041-23', 'FX-0041-023', CONSIGNMENT_0041, 'Berea, Durban'),
        parcel('p041-24', 'FX-0041-024', CONSIGNMENT_0041, 'Berea, Durban'),
        parcel('p041-25', 'FX-0041-025', CONSIGNMENT_0041, 'Berea, Durban'),
        parcel('p041-26', 'FX-0041-026', CONSIGNMENT_0041, 'Berea, Durban'),
        parcel('p041-27', 'FX-0041-027', CONSIGNMENT_0041, 'Berea, Durban'),
      ],
    },
  ],
}

export const mockManifest0041: Manifest = {
  trip_id: TRIP_0041_ID,
  total_parcel_count: 27,
  origin_scan_complete: true,
  pulled_at: '2026-05-09T07:05:00Z',
  consignments: [CONSIGNMENT_MANIFEST_0041],
}

// ─── TRP-2026-0042 · 42 parcels · FedEx JHB → DBN ────────────────────────────

const CONSIGNMENT_0042 = 'cons-pp-2026-0042'

const CONSIGNMENT_MANIFEST_0042: ConsignmentManifest = {
  consignment_id: CONSIGNMENT_0042,
  parcel_perfect_reference: 'PP-2026-FX-0042',
  client_organization_id: FEDEX_ORG_ID,
  unit_count_expected: 5,
  total_parcel_count: 42,
  origin_scan_complete: true,
  stops: [
    {
      delivery_stop: 'Morningside, Durban',
      parcel_count: 24,
      parcels: Array.from({ length: 24 }, (_, i) => parcel(
        `p042-${String(i + 1).padStart(2, '0')}`,
        `FX-0042-${String(i + 1).padStart(3, '0')}`,
        CONSIGNMENT_0042,
        'Morningside, Durban',
        'scanned_out',
        '2026-05-08T16:40:00Z',
      )),
    },
    {
      delivery_stop: 'Umhlanga, Durban',
      parcel_count: 18,
      parcels: Array.from({ length: 18 }, (_, i) => parcel(
        `p042-${String(i + 25).padStart(2, '0')}`,
        `FX-0042-${String(i + 25).padStart(3, '0')}`,
        CONSIGNMENT_0042,
        'Umhlanga, Durban',
        'scanned_out',
        '2026-05-08T16:40:00Z',
      )),
    },
  ],
}

export const mockManifest0042: Manifest = {
  trip_id: TRIP_0042_ID,
  total_parcel_count: 42,
  origin_scan_complete: true,
  pulled_at: '2026-05-08T15:20:00Z',
  consignments: [CONSIGNMENT_MANIFEST_0042],
}

// ─── TRP-2026-0040 · 32 parcels · FedEx JHB → DBN (dest_gate_in) ─────────────

const CONSIGNMENT_0040 = 'cons-pp-2026-0040'

const CONSIGNMENT_MANIFEST_0040: ConsignmentManifest = {
  consignment_id: CONSIGNMENT_0040,
  parcel_perfect_reference: 'PP-2026-FX-0040',
  client_organization_id: FEDEX_ORG_ID,
  unit_count_expected: 4,
  total_parcel_count: 32,
  origin_scan_complete: true,
  stops: [
    {
      delivery_stop: 'Riverhorse Valley, Durban',
      parcel_count: 32,
      parcels: Array.from({ length: 32 }, (_, i) => parcel(
        `p040-${String(i + 1).padStart(2, '0')}`,
        `FX-0040-${String(i + 1).padStart(3, '0')}`,
        CONSIGNMENT_0040,
        'Riverhorse Valley, Durban',
        'scanned_out',
        '2026-05-08T08:55:00Z',
      )),
    },
  ],
}

export const mockManifest0040: Manifest = {
  trip_id: TRIP_0040_ID,
  total_parcel_count: 32,
  origin_scan_complete: true,
  pulled_at: '2026-05-08T07:20:00Z',
  consignments: [CONSIGNMENT_MANIFEST_0040],
}

export const mockManifests: Manifest[] = [mockManifest0040, mockManifest0041, mockManifest0042]
