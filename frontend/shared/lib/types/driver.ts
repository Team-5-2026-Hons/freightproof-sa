// Driver: a registered truck driver employed by an operator organisation.
// Identity is verified via IDVS before a trip can begin.
// Mirrors backend DriverRead schema in schemas/people.py.

import type { DriverEvent, BlockchainReceipt } from './blockchain'

export type DriverId = string & { readonly __brand: 'DriverId' }

export type IdvsStatus = 'pending' | 'verified' | 'failed'

export interface Driver {
  id: DriverId
  organization_id: string
  full_name: string
  id_number: string
  phone_number: string
  license_number: string
  is_active: boolean
  idvs_status: IdvsStatus
  idvs_last_verified_at: string | null
  created_at: string
  updated_at: string
}

// Extended driver shape returned by GET /api/v1/drivers/:id — includes event/receipt history.
export interface DriverDetail extends Driver {
  license_expiry: string | null
  events: DriverEvent[]
  receipts: BlockchainReceipt[]
  trip_ids: string[]
}
