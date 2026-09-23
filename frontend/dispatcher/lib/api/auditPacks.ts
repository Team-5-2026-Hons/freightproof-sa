import { api } from './client'
import type {
  AuditPack,
  AuditPackAccessEvent,
  AuditPackCreate,
  AuditPackIssued,
  IncidentDeclaration,
  IncidentDeclarationCreate,
} from '@/lib/types/auditPack'

// Issuing renders a PDF and anchors its seal on Hedera inside the request (~5–10s), so it
// gets longer than the client's default 20s budget would spare on a slow day.
const ISSUE_TIMEOUT_MS = 60_000
const PDF_TIMEOUT_MS = 45_000

export function listAuditPacks(tripId: string): Promise<AuditPack[]> {
  return api.get<AuditPack[]>(`/api/v1/trips/${tripId}/audit-packs`)
}

export function issueAuditPack(tripId: string, body: AuditPackCreate): Promise<AuditPackIssued> {
  return api.post<AuditPackIssued>(`/api/v1/trips/${tripId}/audit-packs`, body, { timeoutMs: ISSUE_TIMEOUT_MS })
}

export function revokeAuditPack(packId: string): Promise<AuditPack> {
  // Idempotent server-side: revoking twice keeps the first revocation's time and author.
  return api.post<AuditPack>(`/api/v1/audit-packs/${packId}/revoke`, {}, { idempotent: true })
}

export function listAuditPackAccessEvents(packId: string): Promise<AuditPackAccessEvent[]> {
  return api.get<AuditPackAccessEvent[]>(`/api/v1/audit-packs/${packId}/access-events`)
}

export function downloadIssuedPdf(packId: string): Promise<Blob> {
  return api.getBlob(`/api/v1/audit-packs/${packId}/pdf`, { timeoutMs: PDF_TIMEOUT_MS })
}

export function previewAuditPdf(tripId: string): Promise<Blob> {
  return api.getBlob(`/api/v1/trips/${tripId}/audit-trail/preview.pdf`, { timeoutMs: PDF_TIMEOUT_MS })
}

/** Hands a fetched file to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function listIncidentDeclarations(tripId: string): Promise<IncidentDeclaration[]> {
  return api.get<IncidentDeclaration[]>(`/api/v1/trips/${tripId}/incident-declarations`)
}

export function recordIncidentDeclaration(tripId: string, body: IncidentDeclarationCreate): Promise<IncidentDeclaration> {
  return api.post<IncidentDeclaration>(`/api/v1/trips/${tripId}/incident-declarations`, body)
}

export function incidentSheetPdf(tripId: string): Promise<Blob> {
  return api.getBlob(`/api/v1/trips/${tripId}/audit-trail/incident-sheet.pdf`, { timeoutMs: PDF_TIMEOUT_MS })
}
