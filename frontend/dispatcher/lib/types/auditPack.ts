// Mirrors the dispatcher-side DTOs in backend/app/schemas/audit_pack.py (AuditPackCreate,
// AuditPackRead, AuditPackIssued, AuditPackAccessEventRead). Kept in this app rather than
// @shared: only the dispatcher issues packs; the client portal has its own read types.

export type AuditPackPurpose = 'insurance_claim' | 'delivery_dispute' | 'police_report' | 'client_audit' | 'sla_evidence'
export type AuditPackExpiryDays = 7 | 30 | 90
export type AuditPackStatus = 'active' | 'expired' | 'revoked'

export const AUDIT_PACK_PURPOSES: { value: AuditPackPurpose; label: string }[] = [
  { value: 'insurance_claim', label: 'Insurance claim' },
  { value: 'delivery_dispute', label: 'Delivery dispute' },
  { value: 'police_report', label: 'Police report' },
  { value: 'client_audit', label: 'Client audit' },
  { value: 'sla_evidence', label: 'SLA evidence' },
]

export const AUDIT_PACK_EXPIRY_OPTIONS: AuditPackExpiryDays[] = [7, 30, 90]

export interface AuditPackCreate {
  recipient_name: string
  recipient_organization: string
  recipient_email: string | null
  purpose: AuditPackPurpose
  external_reference: string | null
  scope_consignment_id: string | null
  include_location_trail: boolean
  include_full_driver_id: boolean
  expires_in_days: AuditPackExpiryDays
}

export interface AuditPack {
  id: string
  pack_label: string
  trip_id: string
  consignment_id: string | null
  purpose: AuditPackPurpose
  external_reference: string | null
  recipient_name: string
  recipient_organization: string
  recipient_email: string | null
  include_location_trail: boolean
  include_full_driver_id: boolean
  manifest_sha256: string
  pdf_sha256: string
  pdf_size_bytes: number
  anchor_status: string
  hedera_topic_id: string | null
  hedera_sequence_number: number | null
  hedera_tx_id: string | null
  hedera_consensus_at: string | null
  issued_at: string
  expires_at: string
  revoked_at: string | null
  status: AuditPackStatus
  view_count: number
  last_viewed_at: string | null
}

export interface AuditPackIssued {
  pack: AuditPack
  share_token: string
  share_url: string
  verify_url: string
}

export interface AuditPackAccessEvent {
  event_type: string
  client_ip: string | null
  user_agent: string | null
  created_at: string
}

// Police-report and notification facts the operator declares after an incident. Shown in
// packs under the Declared tier — FreightProof never captured them itself.
export interface IncidentDeclarationCreate {
  exception_id: string | null
  saps_station: string | null
  saps_cas_number: string | null
  saps_officer: string | null
  reported_to_saps_at: string | null
  tracking_company_notified_at: string | null
  insurer_notified_at: string | null
  client_notified_at: string | null
  insurer_claim_reference: string | null
  note: string | null
}

export interface IncidentDeclaration extends IncidentDeclarationCreate {
  declaration_id: string
  declared_by_name: string | null
  declared_at: string
  tier: 'declared'
}
