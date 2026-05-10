import type { Driver, DriverId } from '@shared/lib/types/driver'
import { OPERATOR_ORG_ID } from './principals'

const driverId = (v: string): DriverId => v as unknown as DriverId

export const DRIVER_DLAMINI_ID = driverId('b7c8d9e0-f1a2-4738-ab82-930415263748')
export const DRIVER_FORMBY_ID  = driverId('c8d9e0f1-a2b3-4849-ac93-041526374859')
export const DRIVER_GULTIG_ID  = driverId('d9e0f1a2-b3c4-4950-ad04-15263748596a')
export const DRIVER_KASONGO_ID = driverId('e0f1a2b3-c4d5-4061-ae15-263748596a7b')

export const mockDrivers: Driver[] = [
  {
    id: DRIVER_DLAMINI_ID,
    organization_id: OPERATOR_ORG_ID,
    full_name: 'Sipho Dlamini',
    id_number: '7801015800087',
    phone_number: '+27825550001',
    license_number: 'DL-78010158',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: '2026-05-01T07:00:00Z',
    created_at: '2024-04-01T08:00:00Z',
    updated_at: '2026-05-01T07:00:00Z',
  },
  {
    id: DRIVER_FORMBY_ID,
    organization_id: OPERATOR_ORG_ID,
    full_name: 'Thabo Formby',
    id_number: '8503125400089',
    phone_number: '+27825550002',
    license_number: 'DL-85031254',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: '2026-04-28T07:00:00Z',
    created_at: '2024-04-01T08:00:00Z',
    updated_at: '2026-04-28T07:00:00Z',
  },
  {
    id: DRIVER_GULTIG_ID,
    organization_id: OPERATOR_ORG_ID,
    full_name: 'Lungelo Gultig',
    id_number: '9007301234083',
    phone_number: '+27825550003',
    license_number: 'DL-90073012',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: '2026-04-25T07:00:00Z',
    created_at: '2024-06-15T08:00:00Z',
    updated_at: '2026-04-25T07:00:00Z',
  },
  {
    id: DRIVER_KASONGO_ID,
    organization_id: OPERATOR_ORG_ID,
    full_name: 'Bongani Kasongo',
    id_number: '8811224567089',
    phone_number: '+27825550004',
    license_number: 'DL-88112245',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: '2026-04-30T07:00:00Z',
    created_at: '2024-08-20T08:00:00Z',
    updated_at: '2026-04-30T07:00:00Z',
  },
]
