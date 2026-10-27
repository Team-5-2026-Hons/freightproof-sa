'use client'

import { useMemo, useState, type ChangeEvent, type DragEvent } from 'react'
import { ANCHOR_STATE_TEXT, UNSUPPORTED_TEXT } from '@/lib/anchor-text'
import { readSealPayload, sealedString } from '@/lib/seal'
import type { PublicPackSeal } from '@/lib/types'
import { CryptoUnavailableError, checkBytesAgainstHash, type AnchorCheckResult } from '@/lib/verify'

type Result = { matches: boolean; actual: string; name: string } | { error: string }

interface Props {
  seal: PublicPackSeal
  sealCheck: AnchorCheckResult | null
}

/** The PDF fingerprint committed inside the Hedera-sealed payload — not the API's own
 *  `pdf_sha256` field, so a check that passes cannot rest on trusting our server. */
export function sealedPdfHash(seal: PublicPackSeal): string | null {
  return sealedString(readSealPayload(seal), 'pdf_sha256')
}

function unconfirmedReason(sealCheck: AnchorCheckResult | null): string {
  return sealCheck ? ANCHOR_STATE_TEXT[sealCheck.state].text : 'the seal is still being checked'
}

export function PdfCheck({ seal, sealCheck }: Props) {
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const sealRead = useMemo(() => readSealPayload(seal), [seal])
  const expected = sealedString(sealRead, 'pdf_sha256')
  const sealVerified = sealCheck?.state === 'verified'

  async function onFile(file: File | undefined): Promise<void> {
    if (!file || busy) return
    if (!expected) {
      setResult({
        error: sealRead.state === 'unreadable'
          ? "The seal payload in this pack could not be read, so the PDF can't be compared."
          : 'This pack has no Hedera seal to compare against.',
      })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const check = await checkBytesAgainstHash(await file.arrayBuffer(), expected)
      setResult({ ...check, name: file.name })
    } catch (error) {
      console.warn('Could not hash the chosen PDF', error)
      setResult({
        error: error instanceof CryptoUnavailableError
          ? UNSUPPORTED_TEXT
          : 'This file could not be read. Choose it again, or try a different copy.',
      })
    } finally {
      setBusy(false)
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    void onFile(file)
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    void onFile(event.dataTransfer.files[0])
  }

  return (
    <div className="no-print">
      <label
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="block cursor-pointer rounded-md border-2 border-dashed border-outline-v px-4 py-5 text-center text-small hover:bg-surf-low focus-within:ring-2 focus-within:ring-sec"
      >
        <span className="font-semibold">Check a PDF copy</span>
        <span className="block text-muted">Choose or drop the PDF you were sent. It is hashed here in your browser and never uploaded.</span>
        <input type="file" accept="application/pdf" className="sr-only" disabled={busy} onChange={onChange} />
      </label>
      {busy && <p aria-live="polite" className="mt-2 text-small text-muted">Hashing…</p>}
      {result && 'error' in result && <p role="alert" className="mt-2 text-small text-warn">{result.error}</p>}
      {result && 'matches' in result && (
        <p
          role="status"
          className={`mt-2 text-small font-semibold ${result.matches ? (sealVerified ? 'text-ok' : 'text-warn') : 'text-err'}`}
        >
          {result.matches
            ? sealVerified
              ? `${result.name} is an unaltered copy of pack ${seal.pack_label} (seal verified on Hedera).`
              : `${result.name} matches the PDF fingerprint in the pack's seal payload, but the seal itself is not confirmed (${unconfirmedReason(sealCheck)}).`
            : `${result.name} is NOT the issued PDF — its fingerprint differs from the one ${sealVerified ? 'sealed on Hedera' : "in the pack's seal payload"}.`}
        </p>
      )}
    </div>
  )
}
