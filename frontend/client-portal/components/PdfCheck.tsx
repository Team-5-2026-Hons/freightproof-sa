'use client'

import { useState } from 'react'
import type { PublicPackSeal } from '@/lib/types'
import { checkBytesAgainstHash } from '@/lib/verify'

type Result = { matches: boolean; actual: string; name: string } | { error: string }

/** The PDF fingerprint committed inside the Hedera-sealed payload — not the API's own
 *  `pdf_sha256` field, so a check that passes cannot rest on trusting our server. */
export function sealedPdfHash(seal: PublicPackSeal): string | null {
  if (!seal.seal) return null
  try {
    const payload = JSON.parse(seal.seal.canonical_payload) as { pdf_sha256?: unknown }
    return typeof payload.pdf_sha256 === 'string' ? payload.pdf_sha256 : null
  } catch {
    return null
  }
}

export function PdfCheck({ seal }: { seal: PublicPackSeal }) {
  const [result, setResult] = useState<Result | null>(null)
  const expected = sealedPdfHash(seal)

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!expected) {
      setResult({ error: 'This pack has no Hedera seal to compare against.' })
      return
    }
    const check = await checkBytesAgainstHash(await file.arrayBuffer(), expected)
    setResult({ ...check, name: file.name })
  }

  return (
    <div className="no-print">
      <label className="block cursor-pointer rounded-md border-2 border-dashed border-outline-v px-4 py-5 text-center text-[13px] hover:bg-surf-low">
        <span className="font-semibold">Check a PDF copy</span>
        <span className="block text-muted">Choose the PDF you were sent. It is hashed here in your browser and never uploaded.</span>
        <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {result && 'error' in result && <p className="mt-2 text-[13px] text-warn">{result.error}</p>}
      {result && 'matches' in result && (
        <p role="status" className={`mt-2 text-[13px] font-semibold ${result.matches ? 'text-ok' : 'text-err'}`}>
          {result.matches
            ? `${result.name} is an unaltered copy of pack ${seal.pack_label}.`
            : `${result.name} is NOT the issued PDF — its fingerprint differs from the one sealed on Hedera.`}
        </p>
      )}
    </div>
  )
}
