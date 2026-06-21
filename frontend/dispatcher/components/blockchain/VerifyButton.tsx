'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { Ic } from '@/components/ui/Ic'
import { useToast } from '@/lib/hooks/useToast'
import { ForensicOnly } from './ForensicOnly'
import type { SubjectType, VerifyResult } from '@shared/lib/types/blockchain'

type Props = {
  subjectType: SubjectType
  subjectId: string
  // When true: fires on mount, result persists (no auto-reset), shows Re-check link.
  autoVerify?: boolean
  onResult?: (r: VerifyResult) => void
  className?: string
}

type UIState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'result'; result: VerifyResult }

function SpinnerRing() {
  return (
    <svg className="animate-spin shrink-0" width={12} height={12} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function MismatchReport({ result, onClose }: { result: VerifyResult; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-xl bg-surf-lowest shadow-xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 text-[16px] font-[700] text-on-surf">
              <Ic n="shield" s={16} className="text-err" />
              Mismatch Report
            </div>
            <div className="text-[12px] text-on-surf-v mt-[3px]">
              {result.status === 'db_mismatch'
                ? 'The database record no longer matches what was recorded on the blockchain.'
                : 'The blockchain record does not match the expected hash.'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 text-[22px] leading-[1] text-on-surf-v hover:text-on-surf"
          >
            ×
          </button>
        </div>

        <div className="mb-5 rounded-lg bg-err-c px-3 py-[10px] text-[12px] leading-relaxed text-on-err-c">
          This trip&apos;s data may have been altered after it was anchored on the blockchain. Do not act on this trip — escalate to your supervisor immediately.
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-[6px] text-[10px] font-[700] uppercase tracking-[0.08em] text-on-surf-v">
              Blockchain anchor (expected)
            </div>
            <div className="break-all rounded-lg bg-surf-low p-[10px] font-mono text-[11px] leading-relaxed tracking-[0.03em] text-on-surf">
              {result.expected_hash ?? '—'}
            </div>
          </div>
          <div>
            <div className="mb-[6px] text-[10px] font-[700] uppercase tracking-[0.08em] text-on-surf-v">
              Database record (current)
            </div>
            <div className="break-all rounded-lg bg-err-c p-[10px] font-mono text-[11px] leading-relaxed tracking-[0.03em] text-err">
              {result.current_hash ?? '—'}
            </div>
          </div>
        </div>

        {result.receipt && (
          <div className="mt-4 border-t border-outline-v/20 pt-4 text-[11px] text-on-surf-v">
            Anchored to Hedera topic {result.receipt.hedera_topic_id ?? '—'} · seq #{result.receipt.hedera_sequence_number ?? '—'}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-outline-v/40 bg-surf-low py-[8px] text-[13px] font-[600] text-on-surf transition-colors hover:bg-surf-high"
        >
          Close
        </button>
      </div>
    </div>
  )
}

export function VerifyButton({
  subjectType, subjectId, autoVerify = false, onResult, className = '',
}: Props) {
  const { notify } = useToast()
  const [ui, setUi] = useState<UIState>(autoVerify ? { kind: 'verifying' } : { kind: 'idle' })
  const [showReport, setShowReport] = useState(false)

  const verify = useCallback(async () => {
    setUi({ kind: 'verifying' })
    try {
      const result = await api.post<VerifyResult>('/api/v1/blockchain/verify', {
        subject_type: subjectType,
        subject_id: subjectId,
      }, { idempotent: true })
      setUi({ kind: 'result', result })
      onResult?.(result)
      // Manual verifies auto-reset after 8s; auto-verify results stay visible.
      if (!autoVerify) {
        setTimeout(() => setUi({ kind: 'idle' }), 8000)
      }
    } catch (err) {
      setUi({ kind: 'idle' })
      notify({
        kind: 'error',
        title: 'Blockchain check failed',
        body: err instanceof Error ? err.message : 'Could not reach the verification service.',
      })
    }
  }, [subjectType, subjectId, autoVerify, onResult, notify])

  // Defer to next tick so verify()'s synchronous setUi call doesn't fire during render.
  useEffect(() => {
    if (autoVerify) setTimeout(() => { void verify() }, 0)
  }, [autoVerify, verify])

  const reCheckButton = autoVerify ? (
    <button
      onClick={verify}
      className="mt-[4px] flex items-center gap-[4px] text-[10px] font-[500] text-chain opacity-60 transition-opacity hover:opacity-100"
    >
      <Ic n="hex" s={9} className="text-chain" />
      Re-check
    </button>
  ) : null

  if (ui.kind === 'verifying') {
    return (
      <div className={`mt-2 flex items-center gap-[6px] rounded-[var(--r-md)] bg-surf-high px-[8px] py-[6px] text-[11px] font-[500] text-on-surf-v ${className}`}>
        <SpinnerRing />
        Checking blockchain integrity…
      </div>
    )
  }

  if (ui.kind === 'result') {
    const r = ui.result

    if (r.status === 'verified') {
      return (
        <div className={`mt-2 ${className}`}>
          <div className="rounded-[var(--r-md)] bg-ok-c px-[10px] py-[8px]">
            <div className="flex items-center gap-[6px] text-[12px] font-[700] text-on-ok-c">
              <Ic n="shield" s={13} className="text-ok" />
              Records intact
            </div>
            <div className="mt-[4px] text-[11px] leading-snug text-on-ok-c/80">
              All data matches the blockchain record. Nothing has been altered.
            </div>
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'db_mismatch' || r.status === 'hedera_mismatch') {
      return (
        <div className={`mt-2 ${className}`}>
          <ForensicOnly>
            {showReport && <MismatchReport result={r} onClose={() => setShowReport(false)} />}
          </ForensicOnly>
          <div className="rounded-[var(--r-md)] bg-err-c px-[10px] py-[8px]">
            <div className="flex items-center gap-[6px] text-[12px] font-[700] text-on-err-c">
              <Ic n="warn" s={13} className="text-err" />
              Mismatch Detected
            </div>
            <div className="mt-[4px] text-[11px] leading-snug text-on-err-c/80">
              This trip&apos;s data does not match the blockchain record. Escalate immediately.
            </div>
            <ForensicOnly>
              <button
                onClick={() => setShowReport(true)}
                className="mt-[6px] flex items-center gap-[5px] rounded-[var(--r-sm)] border border-err/30 bg-err/10 px-[8px] py-[4px] text-[10px] font-[600] text-on-err-c transition-colors hover:bg-err/20"
              >
                <Ic n="file" s={10} className="text-on-err-c" />
                View Mismatch Report
              </button>
            </ForensicOnly>
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'error') {
      return (
        <div className={`mt-2 ${className}`}>
          <div className="flex items-center gap-[6px] rounded-[var(--r-md)] bg-warn-c px-[10px] py-[7px]">
            <Ic n="warn" s={12} className="text-warn" />
            <div>
              <div className="text-[11px] font-[700] text-on-warn-c">Blockchain check unavailable</div>
              <div className="mt-[1px] text-[10px] text-on-warn-c/70">Try again later</div>
            </div>
          </div>
          {reCheckButton}
        </div>
      )
    }

    // no_receipt
    return (
      <div className={`mt-2 ${className}`}>
        <div className="text-[11px] font-[500] text-chain-onc opacity-60">
          No anchor on file for this trip
        </div>
        {reCheckButton}
      </div>
    )
  }

  // idle — manual mode only
  return (
    <button
      onClick={verify}
      className={`mt-2 flex w-full items-center justify-center gap-[5px] rounded-[var(--r-md)] border border-chain/30 bg-chain/10 px-[10px] py-[5px] text-[11px] font-[600] text-chain transition-all duration-[120ms] hover:bg-chain/15 active:scale-[0.97] ${className}`}
    >
      <Ic n="hex" s={11} className="text-chain" />
      Verify integrity
    </button>
  )
}
