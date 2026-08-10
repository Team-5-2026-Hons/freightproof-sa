import type { Organization, OrganizationId } from '@shared/lib/types/precinct'

const orgId = (v: string): OrganizationId => v as unknown as OrganizationId

// Linbro Express is the fictional freight operator using FreightProof in the demo.
export const OPERATOR_ORG_ID = orgId('a0b1c2d3-e4f5-4061-8a1b-2c3d4e5f6071')
export const FEDEX_ORG_ID    = orgId('b1c2d3e4-f5a6-4172-9b2c-3d4e5f607182')
export const CGY_ORG_ID      = orgId('c2d3e4f5-a6b7-4283-ac3d-4e5f60718293')

export const mockOperator: Organization = {
  id: OPERATOR_ORG_ID,
  name: 'Linbro Express (Pty) Ltd',
  org_type: 'operator',
  contact_email: 'dispatch@linbroexpress.co.za',
  created_at: '2024-01-10T08:00:00Z',
}

export const mockPrincipals: Organization[] = [
  {
    id: FEDEX_ORG_ID,
    name: 'FedEx South Africa',
    org_type: 'principal',
    contact_email: 'operations.za@fedex.com',
    created_at: '2024-01-15T08:00:00Z',
  },
  {
    id: CGY_ORG_ID,
    name: 'The Courier Guy',
    org_type: 'principal',
    contact_email: 'ops@thecourierguy.co.za',
    created_at: '2024-02-20T08:00:00Z',
  },
]
