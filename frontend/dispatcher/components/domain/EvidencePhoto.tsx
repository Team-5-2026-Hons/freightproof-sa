'use client'

import { useEffect, useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

interface Props {
  label: string
  artifact: EvidenceArtifactWithUrl | undefined
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

/**
 * One captured photo: thumbnail expanding to a lightbox.
 *
 * Three distinct states, deliberately all visible rather than collapsed into one:
 *   no artifact      — nothing was captured at this step
 *   no signed_url    — evidence exists, the image could not be served
 *   both present     — the photo
 * Conflating the middle case with the first would hide a storage failure behind
 * "nothing was captured", which on an evidence platform is the wrong lie.
 */
export function EvidencePhoto({ label, artifact }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  // Escape must close the lightbox for keyboard users, since the thumbnail
  // trigger is a real <button> but the overlay itself has no other focusable
  // control besides the explicit close button below.
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen])

  if (!artifact) {
    return (
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
        <div className="text-[12px] text-on-surf-v">Not captured</div>
      </div>
    )
  }

  if (!artifact.signed_url) {
    return (
      <div>
        <div className="text-[10px] text-on-surf-v mb-[1px]">{label}</div>
        <div className="flex items-center gap-[5px] text-[12px] text-warn">
          <Ic n="warn" s={12} className="text-warn" />
          Recorded, image unavailable
        </div>
        {/* Especially here: the picture could not be served, so the hash and capture fix
            are the only evidence left standing. */}
        <ArtifactProvenance artifact={artifact} />
      </div>
    )
  }

  return (
    <div>
      <div className="text-[10px] text-on-surf-v mb-[3px]">{label}</div>
      <button
        onClick={() => setIsOpen(true)}
        className="block rounded-md overflow-hidden border border-outline-v/30 hover:border-outline-v transition-colors"
      >
        {/* Plain <img>: the signed URL is an external host with a short TTL, which
            next/image's optimiser cannot cache or revalidate usefully. */}
        <img
          src={artifact.signed_url}
          alt={label}
          className="w-[96px] h-[96px] object-cover"
        />
      </button>
      <ArtifactProvenance artifact={artifact} />

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-zoom-out"
        >
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close"
            className="absolute top-4 right-4 text-[22px] leading-[1] text-on-surf-v hover:text-on-surf"
          >
            ×
          </button>
          <img
            src={artifact.signed_url}
            alt={label}
            className="max-w-full max-h-full object-contain rounded-md"
          />
        </div>
      )}
    </div>
  )
}
