'use client'

import { useEffect, useState } from 'react'
import { fetchArtifactBytes } from '@/lib/api'
import { humanise } from '@/lib/format'
import type { EvidenceFile } from '@/lib/types'
import { checkBytesAgainstHash } from '@/lib/verify'
import { TierBadge } from './TierBadge'

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; url: string; bytes: ArrayBuffer }

export function EvidencePhoto({ token, file }: { token: string; file: EvidenceFile }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [check, setCheck] = useState<{ matches: boolean; actual: string } | null>(null)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    fetchArtifactBytes(token, file.artifact_id)
      .then((bytes) => {
        if (cancelled) return
        url = URL.createObjectURL(new Blob([bytes], { type: file.mime_type }))
        setLoad({ state: 'ready', url, bytes })
      })
      .catch(() => !cancelled && setLoad({ state: 'failed' }))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, file.artifact_id, file.mime_type])

  async function verifyBytes() {
    if (load.state === 'ready') setCheck(await checkBytesAgainstHash(load.bytes, file.sha256))
  }

  const isImage = file.mime_type.startsWith('image/')
  return (
    <figure className="rounded-md border border-outline-v/60 p-2">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-surf-low">
        {load.state === 'ready' && isImage && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL of evidence bytes; next/image cannot optimise it and must not alter it
          <img src={load.url} alt={`${humanise(file.role)} evidence`} className="h-full w-full object-contain" />
        )}
        {load.state === 'ready' && !isImage && <span className="text-[12px] text-muted">{file.mime_type} document</span>}
        {load.state === 'loading' && <span className="text-[12px] text-muted">Loading…</span>}
        {load.state === 'failed' && <span className="text-[12px] text-warn">File unavailable</span>}
      </div>
      <figcaption className="mt-2 space-y-1 text-[12px]">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold">{humanise(file.role)}</span>
          <TierBadge tier={file.tier} />
        </span>
        <span className="num block break-all text-[11px] text-muted">sha256 {file.sha256}</span>
        <button
          type="button"
          disabled={load.state !== 'ready'}
          onClick={() => void verifyBytes()}
          className="no-print rounded-md bg-surf-high px-2 py-1 text-[12px] font-semibold disabled:opacity-50"
        >
          Verify this file&apos;s bytes in my browser
        </button>
        {check && (
          <span role="status" className={`block font-semibold ${check.matches ? 'text-ok' : 'text-err'}`}>
            {check.matches
              ? file.tier === 'anchored'
                ? 'Byte-identical to the file whose hash is anchored on Hedera.'
                : 'Byte-identical to the file FreightProof recorded (not anchored).'
              : `Does NOT match the recorded hash (got ${check.actual.slice(0, 16)}…).`}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
