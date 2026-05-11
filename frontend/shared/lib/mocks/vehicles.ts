import type { Vehicle, VehicleId } from '@shared/lib/types/vehicle'
import { OPERATOR_ORG_ID } from './principals'

const vehicleId = (v: string): VehicleId => v as unknown as VehicleId

export const HORSE_1_ID   = vehicleId('f1a2b3c4-d5e6-4172-9526-374859607080')
export const HORSE_2_ID   = vehicleId('a2b3c4d5-e6f7-4283-b637-48596a7b8c90')
export const HORSE_3_ID   = vehicleId('b3c4d5e6-f7a8-4394-b748-596a7b8c9d00')
export const TRAILER_1_ID = vehicleId('c4d5e6f7-a8b9-4405-a859-6a7b8c9d0e10')
export const TRAILER_2_ID = vehicleId('d5e6f7a8-b9c0-4516-a960-7b8c9d0e1f20')
export const TRAILER_3_ID = vehicleId('e6f7a8b9-c0d1-4627-aa71-8c9d0e1f2031')
export const TRAILER_4_ID = vehicleId('f7a8b9c0-d1e2-4738-ab82-9d0e1f203142')
export const TRAILER_5_ID = vehicleId('a8b9c0d1-e2f3-4849-ac93-0e1f20314253')

export const mockHorses: Vehicle[] = [
  {
    id: HORSE_1_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'GP 12-34 ZX',
    vehicle_type: 'horse',
    pulsit_device_id: 'PLT-H-001',
    is_active: true,
    created_at: '2024-01-25T08:00:00Z',
  },
  {
    id: HORSE_2_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'KZN 56-78 YP',
    vehicle_type: 'horse',
    pulsit_device_id: 'PLT-H-002',
    is_active: true,
    created_at: '2024-02-10T08:00:00Z',
  },
  {
    id: HORSE_3_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'GP 90-12 WH',
    vehicle_type: 'horse',
    pulsit_device_id: 'PLT-H-003',
    is_active: true,
    created_at: '2024-03-15T08:00:00Z',
  },
]

export const mockTrailers: Vehicle[] = [
  {
    id: TRAILER_1_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'GP T 1234',
    vehicle_type: 'trailer',
    pulsit_device_id: 'PLT-T-001',
    is_active: true,
    created_at: '2024-01-25T08:00:00Z',
  },
  {
    id: TRAILER_2_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'KZN T 5678',
    vehicle_type: 'trailer',
    pulsit_device_id: 'PLT-T-002',
    is_active: true,
    created_at: '2024-02-10T08:00:00Z',
  },
  {
    id: TRAILER_3_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'GP T 9012',
    vehicle_type: 'trailer',
    pulsit_device_id: 'PLT-T-003',
    is_active: true,
    created_at: '2024-02-20T08:00:00Z',
  },
  {
    id: TRAILER_4_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'KZN T 3456',
    vehicle_type: 'trailer',
    pulsit_device_id: 'PLT-T-004',
    is_active: true,
    created_at: '2024-03-01T08:00:00Z',
  },
  {
    id: TRAILER_5_ID,
    organization_id: OPERATOR_ORG_ID,
    registration: 'WC T 7890',
    vehicle_type: 'trailer',
    pulsit_device_id: 'PLT-T-005',
    is_active: true,
    created_at: '2024-03-15T08:00:00Z',
  },
]

export const mockVehicles: Vehicle[] = [...mockHorses, ...mockTrailers]
