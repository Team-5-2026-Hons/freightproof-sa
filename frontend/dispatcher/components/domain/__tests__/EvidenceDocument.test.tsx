import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { EvidenceDocument } from '../EvidenceDocument'

function document_(overrides: Partial<EvidenceArtifactWithUrl> = {}): EvidenceArtifactWithUrl {
  return {
    id: 'a1' as EvidenceArtifactWithUrl['id'], trip_id: 't', artifact_type: 'document', s3_key: 'k', s3_bucket: 'b',
    file_hash: 'f'.repeat(64), mime_type: 'image/png', captured_at: '2026-01-01T10:00:00Z', captured_by_driver_id: null,
    captured_by_user_id: null, captured_lat: null, captured_lng: null, created_at: '2026-01-01T10:00:00Z',
    phase_event_id: null, evidence_role: null, signed_url: null, ...overrides,
  }
}

describe('EvidenceDocument Retry', () => {
  it('styles Retry as a link-weight control, not an unstyled button at body size, when the lookup failed', () => {
    const onRetry = vi.fn()
    render(<EvidenceDocument label="Receiver confirmation" artifact={undefined} artifactId="a1" error="boom" onRetry={onRetry} />)

    const retry = screen.getByRole('button', { name: 'Retry Receiver confirmation' })
    expect(retry).toHaveClass('text-meta', 'underline', 'min-h-11')
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('styles Retry the same way when the document is recorded but its link could not be signed', () => {
    render(<EvidenceDocument label="Receiver confirmation" artifact={document_()} onRetry={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Retry Receiver confirmation' })).toHaveClass('text-meta', 'underline')
  })
})
