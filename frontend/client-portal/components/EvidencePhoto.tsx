'use client'

import { useEffect, useState } from 'react'
import { PackError, fetchArtifactBytes } from '@/lib/api'
import { UNSUPPORTED_TEXT } from '@/lib/anchor-text'
import { humanise } from '@/lib/format'
import type { EvidenceFile } from '@/lib/types'
import { CryptoUnavailableError, checkBytesAgainstHash } from '@/lib/verify'
import { TierBadge } from './TierBadge'

type Load =
  | { state: 'loading' }
  | { state: 'failed'; status: number }
  | { state: 'ready'; url: string; bytes: ArrayBuffer }

type Check = { matches: boolean; actual: string } | { error: string }

// Files already downloaded this page session, by artifact id. Picking another event and coming
// back remounts the photo; without this each visit would download (and be logged server-side as
// a photo view) again, and spend the rate limit.
const fileCache = new Map<string, ArrayBuffer>()

// The only types a blob URL may carry. A blob: URL has the portal's own origin, so evidence typed
// text/html or image/svg+xml, opened in a tab, would run as a page of this site. Everything else
// is handed to the browser as opaque bytes, which it can only download.
const OPENABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
const OPAQUE_TYPE = 'application/octet-stream'

interface FailureText {
  text: string
  retry: boolean
}
const FAILURE_BY_STATUS: Record<number, FailureText> = {
  401: { text: 'Access expired — reload the page to enter a new code', retry: false },
  // The server refused to serve bytes that no longer hash to what was sealed. Not retryable:
  // the stored file changed, and only the issuing operator can explain why.
  409: { text: 'The stored file no longer matches the one sealed — contact the issuing operator', retry: false },
  410: { text: 'This link has been closed', retry: false },
  429: { text: 'Too many requests — try again shortly', retry: true },
  503: { text: 'Temporarily unavailable', retry: true },
}
const DEFAULT_FAILURE: FailureText = { text: 'File unavailable', retry: false }

async function hashCheck(bytes: ArrayBuffer, expectedHex: string): Promise<Check> {
  try {
    return await checkBytesAgainstHash(bytes, expectedHex)
  } catch (error) {
    console.warn('Could not hash the evidence file', error)
    return { error: error instanceof CryptoUnavailableError ? UNSUPPORTED_TEXT : 'This file could not be checked in your browser.' }
  }
}

interface Props {
  token: string
  file: EvidenceFile
  // Names the photo ("Photo 2 of 3") instead of its role. Exception photos have only one role.
  label?: string
  // The receipt that committed this photo's hash. undefined = this pack does not tie photos to
  // receipts (manifest v1); null = it does, and no receipt covers this one.
  receiptId?: string | null
}

export function EvidencePhoto({ token, file, label, receiptId }: Props) {
  const name = label ?? humanise(file.role)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [check, setCheck] = useState<Check | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  // Bumped by Retry so the effect below runs again for the same file.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let url: string | null = null
    async function run(): Promise<void> {
      try {
        let bytes = fileCache.get(file.artifact_id)
        if (!bytes) {
          bytes = await fetchArtifactBytes(token, file.artifact_id, controller.signal)
          fileCache.set(file.artifact_id, bytes)
        }
        if (controller.signal.aborted) return
        url = URL.createObjectURL(new Blob([bytes], { type: OPENABLE_TYPES.has(file.mime_type) ? file.mime_type : OPAQUE_TYPE }))
        setLoad({ state: 'ready', url, bytes })
        // Checked as soon as the bytes are here: the reader should not have to ask whether a photo is the photo.
        const outcome = await hashCheck(bytes, file.sha256)
        if (!controller.signal.aborted) setCheck(outcome)
      } catch (error) {
        // Leaving the page (or the event) aborts the download on purpose; that is not a failure.
        if (controller.signal.aborted) return
        console.warn('Could not load the evidence file', error)
        setLoad({ state: 'failed', status: error instanceof PackError ? error.status : 0 })
      }
    }
    void run()
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, file.artifact_id, file.mime_type, file.sha256, attempt])

  function retry(): void {
    setLoad({ state: 'loading' })
    setCheck(null)
    setImageFailed(false)
    setAttempt((n) => n + 1)
  }

  async function verifyAgain(): Promise<void> {
    if (load.state !== 'ready') return
    setCheck(null)
    setCheck(await hashCheck(load.bytes, file.sha256))
  }

  const isImage = file.mime_type.startsWith('image/')
  const failure = load.state === 'failed' ? (FAILURE_BY_STATUS[load.status] ?? DEFAULT_FAILURE) : null
  return (
    <figure className="rounded-md border border-outline-v/60 p-2">
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-1 overflow-hidden rounded-sm bg-surf-low">
        {load.state === 'ready' && isImage && !imageFailed && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL of evidence bytes; next/image cannot optimise it and must not alter it
          <img
            src={load.url} alt={`${name} evidence`} loading="lazy" decoding="async"
            onError={() => {
              console.warn('The browser could not display this evidence image', file.artifact_id)
              setImageFailed(true)
            }}
            className="h-full w-full object-contain"
          />
        )}
        {load.state === 'ready' && isImage && imageFailed && <span className="text-meta text-warn">Could not display this image</span>}
        {load.state === 'ready' && !isImage && <span className="text-meta text-muted">{file.mime_type} document</span>}
        {load.state === 'ready' && (!isImage || imageFailed) && (
          <a href={load.url} target="_blank" rel="noopener" className="no-print inline-flex min-h-11 items-center text-meta font-semibold text-sec underline">
            Open file
          </a>
        )}
        {load.state === 'loading' && <span className="text-meta text-muted">Loading…</span>}
        {failure && <span className="text-center text-meta text-warn">{failure.text}</span>}
        {failure?.retry && (
          <button type="button" onClick={retry} className="no-print min-h-11 rounded-md bg-surf-high px-3 py-2 text-meta font-semibold">
            Retry
          </button>
        )}
      </div>
      <figcaption className="mt-2 space-y-1 text-meta">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold">{name}</span>
          <TierBadge tier={file.tier} />
        </span>
        <span className="num block break-all text-caption text-muted">sha256 {file.sha256}</span>
        {receiptId !== undefined && (
          <span className="num block break-all text-caption text-muted">
            {receiptId === null ? 'Not covered by a receipt' : `Committed by receipt ${receiptId}`}
          </span>
        )}
        <button
          type="button"
          disabled={load.state !== 'ready'}
          onClick={() => void verifyAgain()}
          className="no-print min-h-11 rounded-md bg-surf-high px-3 py-2 text-meta font-semibold disabled:opacity-50"
        >
          Verify again
        </button>
        {load.state === 'ready' && check === null && <span aria-live="polite" className="block text-muted">Checking this file in your browser…</span>}
        {check && 'error' in check && <span role="status" className="block font-semibold text-warn">{check.error}</span>}
        {check && 'matches' in check && (
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
