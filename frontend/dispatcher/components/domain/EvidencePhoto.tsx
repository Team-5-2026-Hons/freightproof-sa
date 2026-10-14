'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

interface Props {
  label: string
  artifact: EvidenceArtifactWithUrl | undefined
  artifactId?: string | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

/**
 * Where and when this image was captured, and the hash that binds it to the chain.
 *
 * Forensic-only because it is the reviewer's layer, not the dispatcher's — but it is the
 * whole evidential point of storing a photo: without the hash the image is a picture,
 * and with it the image is proof. The backend has sent all four fields since artifacts
 * existed; the panel rendered the picture and dropped every one of them.
 */
function ArtifactProvenance({ artifact }: { artifact: EvidenceArtifactWithUrl }) {
  const hasFix = artifact.captured_lat !== null && artifact.captured_lng !== null

  return (
    <ForensicOnly>
      <div className="mt-[5px] text-[10px] leading-[1.5] text-on-surf-v">
        <div className="tabular-nums">Captured {fmtDateTime(artifact.captured_at)}</div>
        {hasFix && (
          <div className="font-mono tabular-nums tracking-[0.02em]">
            {artifact.captured_lat!.toFixed(5)}, {artifact.captured_lng!.toFixed(5)}
          </div>
        )}
        {/* Truncated head and tail, like every other hash on this page — enough to
            eyeball against a receipt, and the full value is one click away. */}
        <button
          onClick={e => {
            e.stopPropagation()
            navigator.clipboard.writeText(artifact.file_hash).catch(() => {})
          }}
          title={artifact.file_hash}
          className="font-mono tracking-[0.02em] hover:text-on-surf transition-colors"
        >
          SHA-256 {artifact.file_hash.slice(0, 8)}…{artifact.file_hash.slice(-8)}
        </button>
      </div>
    </ForensicOnly>
  )
}

/** Optional lookup state distinguishes absent capture from an unavailable recorded artifact. */
export function EvidencePhoto({ label, artifact, artifactId, loading = false, error, onRetry }: Props) {
  const artifactKey = artifactId ?? artifact?.id ?? label
  const [openKey, setOpenKey] = useState<string | null>(null)
  const isOpen = openKey === artifactKey
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const imageFailed = !!artifact?.signed_url && failedUrl === artifact.signed_url
  const unavailable = !artifact || !artifact.signed_url || imageFailed

  const message = loading ? 'Loading evidence…'
    : error ? 'Evidence lookup failed'
    : !artifact ? (artifactId ? 'Recorded artifact unavailable' : 'Not captured')
    : !artifact.signed_url ? 'Recorded, image unavailable'
    : 'Image failed to load'

  function retry(): void {
    setFailedUrl(null)
    setRetryAttempt(value => value + 1)
    onRetry?.()
  }

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[3px]">{label}</div>
      {unavailable ? (
        <div className="text-[12px] text-on-surf-v" role="status">
          {message}
          {onRetry && !loading && (artifactId || artifact || error) && (
            <button type="button" onClick={retry} className="ml-2 underline">Retry {label}</button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setOpenKey(artifactKey)} aria-label={`Open ${label}`}
          className="block rounded-md overflow-hidden border border-outline-v/30 hover:border-outline-v transition-colors">
          {/* Signed URLs expire and cannot usefully be cached by the image optimiser. */}
          <img key={retryAttempt} src={artifact.signed_url!} alt={label}
            onError={() => setFailedUrl(artifact.signed_url)} className="w-[96px] h-[96px] object-cover" />
        </button>
      )}
      {artifact && <ArtifactProvenance artifact={artifact} />}
      <Modal open={isOpen} onClose={() => setOpenKey(null)} title={label} size="lg">
        {imageFailed ? <div role="status">Image failed to load{onRetry && <button onClick={retry}>Retry {label}</button>}</div>
          : artifact?.signed_url && <img src={artifact.signed_url} alt={label}
            onError={() => setFailedUrl(artifact.signed_url)} className="max-w-full max-h-[70dvh] mx-auto object-contain rounded-md" />}
      </Modal>
    </div>
  )
}
