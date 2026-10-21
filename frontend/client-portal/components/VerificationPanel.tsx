'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runServerVerification } from '@/lib/api'
import { ANCHOR_STATE_TEXT } from '@/lib/anchor-text'
import { formatSast, humanise, pluralise } from '@/lib/format'
import type { AnchoredRecord, LiveCheckStatus, LiveVerification, PublicPackSeal } from '@/lib/types'
import {
  type AnchorCheckResult,
  type AnchorCheckState,
  type AnchorToCheck,
  PINNED_TOPIC_ID,
  trustedMirrorBase,
  verifyAnchoredRecord,
} from '@/lib/verify'

interface Props {
  token: string
  seal: PublicPackSeal
  records: AnchoredRecord[]
  // Reported so the rest of the page (the PDF check) can say whether the seal itself was confirmed.
  onSealCheck?: (result: AnchorCheckResult) => void
}

type Checks = Record<string, AnchorCheckResult>

interface Target {
  key: string
  label: string
  // null for a pack issued without a seal receipt: there is nothing to check, which is itself the result.
  anchor: AnchorToCheck | null
}

// A uuid receipt id can never equal this, so the seal row never collides with a record row.
const SEAL_KEY = 'seal'
// The mirror node is a shared public service: a pack with dozens of records must not open dozens of connections at once.
const MAX_CONCURRENT_CHECKS = 4
const NOT_SEALED: AnchorCheckResult = { state: 'no_receipt' }
// States where the pack contradicts itself or the ledger, as opposed to merely not being confirmed.
const FAILING_STATES: ReadonlySet<AnchorCheckState> = new Set(['hash_mismatch', 'ledger_mismatch', 'topic_mismatch'])

const SERVER_TEXT: Record<LiveVerification['seal_status'], string> = {
  verified: 'unchanged since issue',
  db_mismatch: 'CHANGED since issue',
  hedera_mismatch: 'does not match Hedera',
  no_receipt: 'no receipt',
  error: 'could not be checked',
}

// What to tell the reader about each way a live record can fail to verify. Each has its own
// wording and tone: a changed record is a finding, a failed check is only an unfinished one.
const RECORD_PROBLEM: Record<Exclude<LiveCheckStatus, 'verified'>, { tone: string; text: (n: number) => string }> = {
  db_mismatch: {
    tone: 'font-semibold text-err',
    text: (n) => `Live records that no longer match their anchor: ${n}. This pack still shows the anchored values; ask the operator why the record changed.`,
  },
  hedera_mismatch: {
    tone: 'font-semibold text-err',
    text: (n) => `Live records that do not match what Hedera holds: ${n}.`,
  },
  error: {
    tone: 'text-warn',
    text: (n) => `Live records that could not be checked just now: ${n}. Try again later.`,
  },
  no_receipt: {
    tone: 'text-warn',
    text: (n) => `Live records with no ledger receipt to check: ${n}.`,
  },
}
const RECORD_PROBLEM_ORDER = ['db_mismatch', 'hedera_mismatch', 'error', 'no_receipt'] as const

/** Hedera's "seconds.nanos" consensus time as a readable UTC instant. */
function consensusText(value: string | undefined): string {
  if (!value) return ''
  const seconds = Number(value.split('.')[0])
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().replace('.000Z', 'Z') : value
}

export function VerificationPanel({ token, seal, records, onSealCheck }: Props) {
  const [checks, setChecks] = useState<Checks>({})
  const [server, setServer] = useState<LiveVerification | 'checking' | 'failed' | null>(null)
  // Each run takes the next id; a result from any other id is stale and dropped.
  const runId = useRef(0)
  const onSealCheckRef = useRef(onSealCheck)
  useEffect(() => {
    onSealCheckRef.current = onSealCheck
  }, [onSealCheck])

  // Never the server's own mirror address: see trustedMirrorBase.
  const mirrorBase = useMemo(() => trustedMirrorBase(seal.hedera_network, seal.mirror_base_url), [seal.hedera_network, seal.mirror_base_url])

  // The seal row is always first, sealed or not: a pack with no seal must say so, not look verified.
  const targets = useMemo<Target[]>(() => [
    { key: SEAL_KEY, label: `Pack seal · ${seal.pack_label}`, anchor: seal.seal },
    ...records.map((r) => ({ key: r.receipt_id, label: `${humanise(r.receipt_type)} · ${humanise(r.subject_type)}`, anchor: r })),
  ], [seal.seal, seal.pack_label, records])

  // Results arrive one by one; a target with no result yet renders as "Checking…".
  const runChecks = useCallback(async (keys: ReadonlySet<string>) => {
    const run = ++runId.current
    const queue = targets.filter((t) => keys.has(t.key))
    let next = 0
    async function worker(): Promise<void> {
      while (next < queue.length) {
        const target = queue[next++]
        let result: AnchorCheckResult
        try {
          result = target.anchor ? await verifyAnchoredRecord(target.anchor, mirrorBase) : NOT_SEALED
        } catch (error) {
          // verifyAnchoredRecord is meant to be total; if it ever is not, the row must not hang on "Checking…".
          console.warn('Browser check failed unexpectedly', error)
          result = { state: 'unavailable' }
        }
        if (run !== runId.current) return
        setChecks((current) => ({ ...current, [target.key]: result }))
        if (target.key === SEAL_KEY) onSealCheckRef.current?.(result)
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, queue.length) }, worker))
  }, [targets, mirrorBase])

  useEffect(() => {
    void runChecks(new Set(targets.map((t) => t.key)))
    return () => {
      // Unmounting, or the pack changing, supersedes whatever is still in flight.
      runId.current += 1
    }
  }, [runChecks, targets])

  // Re-checks only what is not already confirmed: a verified row has nothing to gain from a second request.
  const unverifiedKeys = targets.filter((t) => checks[t.key]?.state !== 'verified').map((t) => t.key)
  function rerunBrowserChecks() {
    const keys = new Set(unverifiedKeys)
    setChecks((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.has(key))))
    void runChecks(keys)
  }

  const sealResult = checks[SEAL_KEY]
  const recordStates = records.map((r) => checks[r.receipt_id]?.state)
  const recordsVerified = recordStates.filter((state) => state === 'verified').length
  const recordsFailed = recordStates.filter((state) => state !== undefined && FAILING_STATES.has(state)).length
  const sealFailed = sealResult !== undefined && FAILING_STATES.has(sealResult.state)
  const allVerified = sealResult?.state === 'verified' && recordsVerified === records.length
  const settled = targets.every((t) => checks[t.key] !== undefined)

  async function runServer() {
    setServer('checking')
    try {
      setServer(await runServerVerification(token))
    } catch (error) {
      console.warn('The live re-check failed', error)
      setServer('failed')
    }
  }

  const sealHeadline = !sealResult
    ? 'Checking seal…'
    : sealResult.state === 'verified'
      ? 'Seal verified'
      : sealResult.state === 'no_receipt'
        ? 'Pack not sealed'
        : sealFailed ? 'Seal failed verification' : 'Seal not confirmed'
  const recordsHeadline = recordsFailed > 0
    ? `${pluralise(recordsFailed, 'record')} failed verification`
    : records.length === 0
      ? 'no other anchored records'
      : `${recordsVerified} of ${pluralise(records.length, 'record')} verified in your browser`

  // Green is reserved for a verified seal AND every record verified; anything less must not look like success.
  const tone = sealFailed || recordsFailed > 0
    ? 'border-err bg-err-c'
    : allVerified ? 'border-ok bg-ok-c/25' : settled ? 'border-warn bg-surf-low' : 'border-outline-v bg-surf-low'

  function rowResult(target: Target, check: AnchorCheckResult): { text: string; tone: string } {
    if (target.key === SEAL_KEY && check.state === 'no_receipt') {
      return { text: `This pack was not sealed on Hedera (status: ${humanise(seal.anchor_status)})`, tone: 'text-warn' }
    }
    return ANCHOR_STATE_TEXT[check.state]
  }

  const buttonClass = 'min-h-11 rounded-md bg-surf-high px-3 py-2 text-[13px] font-semibold hover:bg-outline-v/50 disabled:opacity-50'

  return (
    <section aria-labelledby="verify-title" className={`rounded-lg border-2 p-4 sm:p-5 ${tone}`}>
      <h2 id="verify-title" aria-live="polite" className="text-[15px] font-extrabold">
        {sealHeadline} · {recordsHeadline}
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        Your browser hashed each anchored payload itself and confirmed the Hedera {seal.hedera_network} ledger holds that
        hash at the recorded position. This proves those payloads existed unchanged at the times shown; it does not by
        itself prove every figure on this page came from them.
      </p>
      <p className="num mt-1 text-[12px] text-muted">
        {mirrorBase
          ? `Mirror node: ${new URL(mirrorBase).host}`
          : `No trusted mirror node is known for the network “${seal.hedera_network}”, so the ledger cannot be checked.`}
        {PINNED_TOPIC_ID && ` · Topic ${PINNED_TOPIC_ID} (pinned)`}
      </p>
      <ul className="mt-3 divide-y divide-outline-v/40 rounded-md bg-surf-lowest">
        {targets.map((t) => {
          const check = checks[t.key]
          const shown = check ? rowResult(t, check) : null
          return (
            <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="font-semibold">{t.label}</span>
              <span className={`num text-[12px] font-semibold ${shown ? shown.tone : 'text-muted'}`}>
                {!check || !shown
                  ? 'Checking…'
                  : `${shown.text}${check.consensusTimestamp ? ` · ${consensusText(check.consensusTimestamp)}` : ''}`}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="no-print mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={rerunBrowserChecks} disabled={unverifiedKeys.length === 0} className={buttonClass}>
          Re-run browser check
        </button>
        <button type="button" onClick={() => void runServer()} disabled={server === 'checking'} className={buttonClass}>
          Check live records have not changed since issue
        </button>
      </div>
      {server === 'checking' && <p className="mt-2 text-[13px] text-muted">Asking FreightProof to re-check its live records…</p>}
      {server === 'failed' && <p className="mt-2 text-[13px] text-warn">The live re-check could not run. Try again later.</p>}
      {server && typeof server === 'object' && (
        <div className="mt-2 text-[13px]" role="status">
          <p>
            Live check ({formatSast(server.checked_at)}): pack seal {SERVER_TEXT[server.seal_status]};{' '}
            {server.records.filter((r) => r.status === 'verified').length} of {server.records.length} anchored records unchanged.
          </p>
          {RECORD_PROBLEM_ORDER.map((status) => {
            const count = server.records.filter((r) => r.status === status).length
            return count > 0 && <p key={status} className={RECORD_PROBLEM[status].tone}>{RECORD_PROBLEM[status].text(count)}</p>
          })}
          {server.records_added_since_issue > 0 && (
            <p className="text-warn">
              {pluralise(server.records_added_since_issue, 'record')} {server.records_added_since_issue === 1 ? 'was' : 'were'} added
              to this trip after the pack was issued. Ask the operator for an updated pack.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
