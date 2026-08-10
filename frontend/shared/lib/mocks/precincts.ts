import type { Precinct, PrecinctId } from '@shared/lib/types/precinct'
import { FEDEX_ORG_ID, CGY_ORG_ID } from './principals'

const precinctId = (v: string): PrecinctId => v as unknown as PrecinctId

export const PRECINCT_FEDEX_JHB_ID = precinctId('d3e4f5a6-b7c8-4394-ad4e-5f6071829304')
export const PRECINCT_FEDEX_DBN_ID = precinctId('e4f5a6b7-c8d9-4405-ae5f-607182930415')
export const PRECINCT_CGY_JHB_ID   = precinctId('f5a6b7c8-d9e0-4516-af60-718293041526')
export const PRECINCT_CGY_CT_ID    = precinctId('a6b7c8d9-e0f1-4627-b071-829304152637')

export const mockPrecincts: Precinct[] = [
  {
    id: PRECINCT_FEDEX_JHB_ID,
    name: 'FedEx JHB — Linbro Park',
    principal_organization_id: FEDEX_ORG_ID,
    address: '14 Electron Avenue, Linbro Park, Johannesburg, 2065',
    latitude: -26.0942,
    longitude: 28.1342,
    geofence_radius_metres: 300,
    created_at: '2024-01-20T08:00:00Z',
  },
  {
    id: PRECINCT_FEDEX_DBN_ID,
    name: 'FedEx DBN — Riverhorse Valley',
    principal_organization_id: FEDEX_ORG_ID,
    address: '12 Sookhai Place, Riverhorse Valley Business Estate, Durban, 4017',
    latitude: -29.7942,
    longitude: 30.9820,
    geofence_radius_metres: 300,
    created_at: '2024-01-20T08:00:00Z',
  },
  {
    id: PRECINCT_CGY_JHB_ID,
    name: 'Courier Guy JHB — Linbro Park',
    principal_organization_id: CGY_ORG_ID,
    address: '18 Atom Road, Linbro Park, Johannesburg, 2065',
    latitude: -26.0961,
    longitude: 28.1368,
    geofence_radius_metres: 250,
    created_at: '2024-03-01T08:00:00Z',
  },
  {
    id: PRECINCT_CGY_CT_ID,
    name: 'Courier Guy CT — Montague Gardens',
    principal_organization_id: CGY_ORG_ID,
    address: '3 Midas Road, Montague Gardens, Cape Town, 7441',
    latitude: -33.8651,
    longitude: 18.5127,
    geofence_radius_metres: 250,
    created_at: '2024-03-01T08:00:00Z',
  },
]
