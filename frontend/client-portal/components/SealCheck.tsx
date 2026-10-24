'use client'

import { useEffect, useState } from 'react'
import { PackError, fetchSeal } from '@/lib/api'
import { formatSast, humanise } from '@/lib/format'
import type { PublicPackSeal } from '@/lib/types'
import { type AnchorCheckResult, trustedMirrorBase, verifyAnchoredRecord } from '@/lib/verify'
import { Card, Field } from './Card'
import { Eyebrow } from './Eyebrow'
import { PdfCheck } from './PdfCheck'

const RESULT: Record<AnchorCheckResult['state'], string> = {
  verified: 'Seal verified on Hedera',
  hash_mismatch: 'Seal payload does not match its hash',
  ledger_mismatch: 'Hedera holds a different fingerprint',
  topic_mismatch: 'Sealed on a topic FreightProof does not use',
  not_found: 'Hedera has no message at the sealed position — not evidence of tampering',
  unavailable: 'Hedera mirror unreachable — try again',
  unsupported: 'This browser cannot verify (needs a secure HTTPS page)',
  no_receipt: 'This pack was not sealed on Hedera',
}

function loadErrorText(err: unknown): string {
  if (err instanceof PackError) {
    if (err.status === 404) return 'No audit pack has this identifier.'
    if (err.status === 422) return 'That is not a valid audit pack identifier. Check the address printed on the PDF.'
    if (err.status === 429) return 'Too many requests — try again shortly.'
  }
  return 'The seal could not be loaded.'
}

/** The page behind the address printed on every PDF: proves a copy is genuine without
 *  needing the share link and without showing any of the evidence. */
export function SealCheck({ packId }: { packId: string }) {
  const [seal, setSeal] = useState<PublicPackSeal | null>(null)
  const [error, setError] = useState<string | null>(null)
  // When the seal was read, for "Expired on…": taken in the fetch handler because the clock is
  // not something a render may read.
  const [loadedAt, setLoadedAt] = useState(0)
  // Bumped by "Check again": the seal is fetched afresh, because a pack sealed moments after
  // issue only shows its receipt on a later read.
  const [attempt, setAttempt] = useState(0)
  // The result is kept with the seal it belongs to, so a fresh seal reads as "Checking…" and a
  // late answer for an older one can never be shown against it.
  const [checked, setChecked] = useState<{ seal: PublicPackSeal; result: AnchorCheckResult } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchSeal(packId)
      .then((loaded) => {
        if (cancelled) return
        setSeal(loaded)
        setLoadedAt(Date.now())
        setError(null)
      })
      .catch((err: unknown) => {
        console.warn('Could not load the audit pack seal', err)
        if (!cancelled) setError(loadErrorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [packId, attempt])

  useEffect(() => {
    if (!seal) return
    let cancelled = false
    const mirror = trustedMirrorBase(seal.hedera_network, seal.mirror_base_url)
    const outcome = seal.seal ? verifyAnchoredRecord(seal.seal, mirror) : Promise.resolve<AnchorCheckResult>({ state: 'no_receipt' })
    void outcome.then((result) => {
      if (!cancelled) setChecked({ seal, result })
    })
    return () => {
      cancelled = true
    }
  }, [seal])

  // Only a first load that failed replaces the page; once a seal is on screen an error from
  // a refresh is shown beside it instead.
  if (!seal) {
    return error
      ? <p role="alert" className="px-4 py-24 text-center text-sm text-muted">{error}</p>
      : <p className="px-4 py-24 text-center text-sm text-muted">Loading seal…</p>
  }

  const check = checked && checked.seal === seal ? checked.result : null
  const mirror = trustedMirrorBase(seal.hedera_network, seal.mirror_base_url)
  const expired = Date.parse(seal.expires_at) <= loadedAt
  const linkStatus = seal.revoked
    ? 'Revoked by the issuer'
    : expired ? `Expired on ${formatSast(seal.expires_at)}` : `Valid until ${formatSast(seal.expires_at)}`
  const title = !check
    ? 'Checking seal against Hedera…'
    : check.state === 'no_receipt'
      ? `${RESULT.no_receipt} (status: ${humanise(seal.anchor_status)})`
      : RESULT[check.state]

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <Eyebrow size="micro">FreightProof audit pack seal</Eyebrow>
        <h1 className="num text-title font-extrabold">{seal.pack_label}</h1>
      </div>
      <Card title={title}>
        <dl>
          <Field label="Issued"><span className="num">{formatSast(seal.issued_at)}</span></Field>
          <Field label="Link status">{linkStatus}</Field>
          <Field label="PDF fingerprint"><span className="num break-all">{seal.pdf_sha256}</span></Field>
          {seal.seal?.hedera_tx_id && <Field label="Hedera transaction"><span className="num break-all">{seal.seal.hedera_tx_id}</span></Field>}
        </dl>
        <p className="mt-2 text-meta text-muted">
          Checked by your browser against the Hedera {seal.hedera_network} public ledger
          {mirror ? <> via <span className="num">{new URL(mirror).host}</span></> : ' (no trusted mirror for this network)'}.
          This page shows no trip evidence; the full pack is only available through the link the operator shared.
        </p>
        {error && <p role="alert" className="mt-2 text-small text-warn">{error}</p>}
        {check && check.state !== 'verified' && (
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="no-print mt-2 min-h-11 rounded-md bg-surf-high px-3 py-1.5 text-small font-semibold hover:bg-outline-v/50"
          >
            Check again
          </button>
        )}
      </Card>
      <Card title="Is my PDF genuine?"><PdfCheck seal={seal} sealCheck={check} /></Card>
    </main>
  )
}
