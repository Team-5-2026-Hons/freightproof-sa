'use client'

import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { Modal } from '@/components/ui/Modal'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// Retry reads as a link next to the sentence that says what failed, not as an unstyled button
// at body size. One string, because both failure states below offer it.
const RETRY_CLASS = 'ml-2 min-h-11 text-meta font-semibold text-sec underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec disabled:opacity-50'
const ACTION_CLASS = 'shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[9px] font-[600] bg-surf-high text-on-surf-v border border-outline-v/30 hover:bg-outline-v/20 transition-colors'
// Browsers render a PDF natively in a frame, so it can be read in place; any other file type
// (the receiver's signed attestation) can only be opened in a new tab.
const PDF_MIME = 'application/pdf'

interface Props {
  label: string
  artifact: EvidenceArtifactWithUrl | undefined
  artifactId?: string | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

export function EvidenceDocument({ label, artifact, artifactId, loading = false, error, onRetry }: Props) {
  const [viewing, setViewing] = useState(false)

  if (!artifact) {
    return (
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
        <div className="text-[12px] text-on-surf-v">{loading ? 'Loading evidence…' : error ? 'Evidence lookup failed' : artifactId ? 'Recorded artifact unavailable' : 'Not captured'}</div>
        {onRetry && !loading && (artifactId || error) && <button type="button" className={RETRY_CLASS} onClick={onRetry}>Retry {label}</button>}
      </div>
    )
  }

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[3px]">{label}</div>
      <div className="flex items-center gap-[8px]">
        <Ic n="file" s={14} className="text-on-surf-v" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-[500] text-on-surf truncate">{artifact.mime_type}</div>
          <div className="text-[10px] text-on-surf-v tabular-nums">{fmtDateTime(artifact.captured_at)}</div>
        </div>
        {artifact.signed_url ? (
          <>
            {artifact.mime_type === PDF_MIME && (
              <button type="button" onClick={() => setViewing(true)} aria-label={`View ${label}`} className={ACTION_CLASS}>
                View
              </button>
            )}
            <a href={artifact.signed_url} target="_blank" rel="noopener noreferrer" className={ACTION_CLASS}>
              Open ↗
            </a>
          </>
        ) : (
          <span className="shrink-0 text-[10px] text-warn">Recorded, document unavailable {onRetry && <button type="button" className={RETRY_CLASS} disabled={loading} onClick={onRetry}>Retry {label}</button>}</span>
        )}
      </div>
      {artifact.signed_url && artifact.mime_type === PDF_MIME && (
        <Modal open={viewing} onClose={() => setViewing(false)} title={label} size="xl">
          {/* Mounted only while open so a closed modal never fetches the PDF behind the panel. */}
          {viewing && <iframe src={artifact.signed_url} title={label} className="w-full h-[75dvh] rounded-md border border-outline-v/30" />}
        </Modal>
      )}
    </div>
  )
}
