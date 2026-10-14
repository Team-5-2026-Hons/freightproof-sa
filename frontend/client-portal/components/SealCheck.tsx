'use client'

import { useEffect, useState } from 'react'
import { PackError, fetchSeal } from '@/lib/api'
import { formatSast } from '@/lib/format'
import type { PublicPackSeal } from '@/lib/types'
import { type AnchorCheckResult, verifyAnchoredRecord } from '@/lib/verify'
import { Card, Field } from './Card'
import { PdfCheck } from './PdfCheck'

const RESULT: Record<AnchorCheckResult['state'], string> = {
  verified: 'Seal verified on Hedera',
  hash_mismatch: 'Seal payload does not match its hash',
  ledger_mismatch: 'Hedera holds a different fingerprint',
  unavailable: 'Hedera mirror unreachable — try again',
  no_receipt: 'This pack was issued without a Hedera seal',
}

/** The page behind the address printed on every PDF: proves a copy is genuine without
 *  needing the share link and without showing any of the evidence. */
export function SealCheck({ packId }: { packId: string }) {
  const [seal, setSeal] = useState<PublicPackSeal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState<AnchorCheckResult | null>(null)

  useEffect(() => {
    fetchSeal(packId)
      .then(async (loaded) => {
        setSeal(loaded)
        setCheck(loaded.seal ? await verifyAnchoredRecord(loaded.seal, loaded.mirror_base_url) : { state: 'no_receipt' })
      })
      .catch((err: unknown) => setError(err instanceof PackError && err.status === 404 ? 'No audit pack has this identifier.' : 'The seal could not be loaded.'))
  }, [packId])

  if (error) return <p className="px-4 py-24 text-center text-sm text-muted">{error}</p>
  if (!seal) return <p className="px-4 py-24 text-center text-sm text-muted">Loading seal…</p>

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">FreightProof audit pack seal</p>
        <h1 className="num text-[22px] font-extrabold">{seal.pack_label}</h1>
      </div>
      <Card title={check ? RESULT[check.state] : 'Checking seal against Hedera…'}>
        <dl>
          <Field label="Issued"><span className="num">{formatSast(seal.issued_at)}</span></Field>
          <Field label="Link status">{seal.revoked ? 'Revoked by the issuer' : `Valid until ${formatSast(seal.expires_at)}`}</Field>
          <Field label="PDF fingerprint"><span className="num break-all">{seal.pdf_sha256}</span></Field>
          {seal.seal?.hedera_tx_id && <Field label="Hedera transaction"><span className="num break-all">{seal.seal.hedera_tx_id}</span></Field>}
        </dl>
        <p className="mt-2 text-[12px] text-muted">
          Checked by your browser against the Hedera {seal.hedera_network} public ledger. This page shows no trip evidence;
          the full pack is only available through the link the operator shared.
        </p>
      </Card>
      <Card title="Is my PDF genuine?"><PdfCheck seal={seal} /></Card>
    </main>
  )
}
