'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { runServerVerification } from '@/lib/api'
import { humanise } from '@/lib/format'
import type { AnchorCheckResult } from '@/lib/verify'
import { verifyAnchoredRecord } from '@/lib/verify'
import type { AnchoredRecord, LiveVerification, PublicPackSeal } from '@/lib/types'

interface Props {
  token: string
  seal: PublicPackSeal
  records: AnchoredRecord[]
}

type Checks = Record<string, AnchorCheckResult>

const STATE_TEXT: Record<AnchorCheckResult['state'], { text: string; tone: string }> = {
  verified: { text: 'Verified on Hedera', tone: 'text-ok' },
  hash_mismatch: { text: 'Payload does not match its hash', tone: 'text-err' },
  ledger_mismatch: { text: 'Hedera holds a different hash', tone: 'text-err' },
  unavailable: { text: 'Hedera mirror unreachable — try again', tone: 'text-warn' },
  no_receipt: { text: 'No ledger position recorded', tone: 'text-warn' },
}

const SERVER_TEXT: Record<LiveVerification['seal_status'], string> = {
  verified: 'unchanged since issue',
  db_mismatch: 'CHANGED since issue',
  hedera_mismatch: 'does not match Hedera',
  no_receipt: 'no receipt',
  error: 'could not be checked',
}

/** Hedera's "seconds.nanos" consensus time as a readable UTC instant. */
function consensusText(value: string | undefined): string {
  if (!value) return ''
  const seconds = Number(value.split('.')[0])
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().replace('.000Z', 'Z') : value
}

export function VerificationPanel({ token, seal, records }: Props) {
  const [checks, setChecks] = useState<Checks>({})
  const [server, setServer] = useState<LiveVerification | 'checking' | 'failed' | null>(null)

  const targets = useMemo(() => [
    ...(seal.seal ? [{ key: 'seal', label: `Pack seal · ${seal.pack_label}`, anchor: seal.seal }] : []),
    ...records.map((r) => ({ key: r.receipt_id, label: `${humanise(r.receipt_type)} · ${humanise(r.subject_type)}`, anchor: r })),
  ], [seal.seal, seal.pack_label, records])

  // Results arrive one by one; a target with no result yet renders as "Checking…".
  const runBrowserChecks = useCallback(async () => {
    await Promise.all(targets.map(async (t) => {
      const result = await verifyAnchoredRecord(t.anchor, seal.mirror_base_url)
      setChecks((current) => ({ ...current, [t.key]: result }))
    }))
  }, [targets, seal.mirror_base_url])

  useEffect(() => {
    void runBrowserChecks()
  }, [runBrowserChecks])

  function rerunBrowserChecks() {
    setChecks({})
    void runBrowserChecks()
  }

  const results = Object.values(checks)
  const done = results
  const verified = done.filter((r) => r.state === 'verified').length
  const failed = done.filter((r) => r.state === 'hash_mismatch' || r.state === 'ledger_mismatch').length

  async function runServer() {
    setServer('checking')
    try {
      setServer(await runServerVerification(token))
    } catch {
      setServer('failed')
    }
  }

  const tone = failed > 0 ? 'border-err bg-err-c' : verified === targets.length && targets.length > 0 ? 'border-ok bg-[#e7fbf2]' : 'border-outline-v bg-surf-low'

  return (
    <section aria-labelledby="verify-title" className={`rounded-lg border-2 p-4 sm:p-5 ${tone}`}>
      <h2 id="verify-title" className="text-[15px] font-extrabold">
        {failed > 0
          ? `${failed} record${failed === 1 ? '' : 's'} failed verification`
          : `${verified} of ${targets.length} anchored records verified in your browser`}
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        Your browser hashed each record itself and compared it with the Hedera {seal.hedera_network} public
        ledger. FreightProof&apos;s servers were not involved in this check.
      </p>
      <ul className="mt-3 divide-y divide-outline-v/40 rounded-md bg-surf-lowest">
        {targets.map((t) => {
          const check = checks[t.key]
          return (
            <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="font-semibold">{t.label}</span>
              <span className={`num text-[12px] font-semibold ${check ? STATE_TEXT[check.state].tone : 'text-muted'}`}>
                {!check
                  ? 'Checking…'
                  : `${STATE_TEXT[check.state].text}${check.consensusTimestamp ? ` · ${consensusText(check.consensusTimestamp)}` : ''}`}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="no-print mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={rerunBrowserChecks} className="rounded-md bg-surf-high px-3 py-1.5 text-[13px] font-semibold hover:bg-outline-v/50">
          Re-run browser check
        </button>
        <button type="button" onClick={() => void runServer()} className="rounded-md bg-surf-high px-3 py-1.5 text-[13px] font-semibold hover:bg-outline-v/50">
          Check live records have not changed since issue
        </button>
      </div>
      {server === 'checking' && <p className="mt-2 text-[13px] text-muted">Asking FreightProof to re-check its live records…</p>}
      {server === 'failed' && <p className="mt-2 text-[13px] text-warn">The live re-check could not run. Try again later.</p>}
      {server && typeof server === 'object' && (
        <div className="mt-2 text-[13px]" role="status">
          <p>
            Live check ({server.checked_at.slice(0, 16).replace('T', ' ')} UTC): pack seal {SERVER_TEXT[server.seal_status]};{' '}
            {server.records.filter((r) => r.status === 'verified').length} of {server.records.length} anchored records unchanged.
          </p>
          {server.records.some((r) => r.status === 'db_mismatch') && (
            <p className="font-semibold text-err">
              A live record no longer matches its anchor. This pack still shows the anchored values; ask the operator why the record changed.
            </p>
          )}
          {server.records_added_since_issue > 0 && (
            <p className="text-warn">
              {server.records_added_since_issue} record(s) were added to this trip after the pack was issued. Ask the
              operator for an updated pack.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
