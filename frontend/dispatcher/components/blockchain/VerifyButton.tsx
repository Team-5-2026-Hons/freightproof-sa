'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import { Ic } from '@/components/ui/Ic'
import { useToast } from '@/lib/hooks/useToast'
import { Modal } from '@/components/ui/Modal'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { SubjectType, VerifyResult } from '@shared/lib/types/blockchain'

// Storage has a 15s total deadline, followed by the mirror's 10s request.
const VERIFICATION_TIMEOUT_MS = 35_000

type Props = {
  subjectType: SubjectType
  subjectId: string
  // When true: fires on mount and the result persists instead of auto-resetting.
  autoVerify?: boolean
  onResult?: (r: VerifyResult, checkedAt: string) => void
  className?: string
  ariaLabel?: string
}

type UIState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'result'; result: VerifyResult; checkedAt: string }

function SpinnerRing() {
  return (
    <svg aria-hidden="true" className="animate-spin shrink-0" width={12} height={12} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function MismatchReport({ result, onClose }: { result: VerifyResult; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Mismatch report">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 text-[16px] font-[700] text-on-surf">
              <Ic n="shield" s={16} className="text-err" />
              Mismatch Report
            </div>
            <div className="text-[12px] text-on-surf-v mt-[3px]">
              {result.status === 'db_mismatch'
                ? 'The current off-chain state no longer matches the blockchain commitment.'
                : 'The blockchain record does not match the expected hash.'}
            </div>
          </div>

        </div>

        <div className="mb-5 rounded-lg bg-err-c px-3 py-[10px] text-[12px] leading-relaxed text-on-err-c">
          {result.status === 'db_mismatch'
            ? 'The current off-chain record does not match its committed receipt. Review the discrepancy.'
            : 'The current off-chain record matched its receipt, but Hedera did not return the expected hash.'}
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
          {result.status === 'db_mismatch' && <div>
            <div className="mb-[6px] text-[10px] font-[700] uppercase tracking-[0.08em] text-on-surf-v">
              Reconstructed off-chain state
            </div>
            <div className="break-all rounded-lg bg-err-c p-[10px] font-mono text-[11px] leading-relaxed tracking-[0.03em] text-err">
              {result.current_hash ?? '—'}
            </div>
          </div>}
        </div>

        {result.receipt && (
          <div className="mt-4 border-t border-outline-v/20 pt-4 text-[11px] text-on-surf-v">
            Anchored to Hedera topic {result.receipt.hedera_topic_id ?? '—'} · seq #{result.receipt.hedera_sequence_number ?? '—'}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-outline-v/40 bg-surf-low py-[8px] text-[13px] font-[600] text-on-surf transition-colors hover:bg-surf-high"
        >
          Close
        </button>
    </Modal>
  )
}

export function VerifyButton({
  subjectType, subjectId, autoVerify = false, onResult, className = '', ariaLabel,
}: Props) {
  const { notify } = useToast()
  const resultCallback = useRef(onResult)
  const requestVersion = useRef(0)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const idleButtonRef = useRef<HTMLButtonElement>(null)
  const focusPendingOnRender = useRef(false)
  const focusResultOnRender = useRef(false)
  const focusIdleOnRender = useRef(false)
  useEffect(() => { resultCallback.current = onResult }, [onResult])
  const [ui, setUi] = useState<UIState>(autoVerify ? { kind: 'verifying' } : { kind: 'idle' })
  const [showReport, setShowReport] = useState(false)

  useEffect(() => {
    if (ui.kind === 'verifying' && focusPendingOnRender.current) {
      focusPendingOnRender.current = false
      pendingRef.current?.focus()
    }
    if (ui.kind === 'result' && focusResultOnRender.current) {
      focusResultOnRender.current = false
      resultRef.current?.focus()
    }
    if (ui.kind === 'idle' && focusIdleOnRender.current) {
      focusIdleOnRender.current = false
      idleButtonRef.current?.focus()
    }
  }, [ui.kind])

  const verify = useCallback(async (userInitiated = false) => {
    const version = ++requestVersion.current
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    setShowReport(false)
    focusPendingOnRender.current = userInitiated
    setUi({ kind: 'verifying' })
    try {
      const result = await api.post<VerifyResult>('/api/v1/blockchain/verify', {
        subject_type: subjectType,
        subject_id: subjectId,
      }, { idempotent: true, timeoutMs: VERIFICATION_TIMEOUT_MS })
      if (version !== requestVersion.current) return
      const checkedAt = new Date().toISOString()
      focusResultOnRender.current = userInitiated && (
        document.activeElement === pendingRef.current
        || (pendingRef.current === null && document.activeElement === document.body)
      )
      setUi({ kind: 'result', result, checkedAt })
      resultCallback.current?.(result, checkedAt)
      // Manual verifies auto-reset after 8s; auto-verify results stay visible.
      if (!autoVerify) {
        resetTimer.current = setTimeout(() => {
          resetTimer.current = null
          focusIdleOnRender.current = resultRef.current?.contains(document.activeElement) ?? false
          setShowReport(false)
          setUi({ kind: 'idle' })
        }, 8000)
      }
    } catch (err) {
      if (version !== requestVersion.current) return
      focusIdleOnRender.current = userInitiated && (
        document.activeElement === pendingRef.current
        || (pendingRef.current === null && document.activeElement === document.body)
      )
      setUi({ kind: 'idle' })
      notify({
        kind: 'error',
        title: 'Blockchain check failed',
        body: err instanceof Error ? err.message : 'Could not reach the verification service.',
      })
    }
  }, [subjectType, subjectId, autoVerify, notify])

  // Defer to next tick so verify()'s synchronous setUi call doesn't fire during render.
  useEffect(() => {
    const initialVersion = requestVersion.current
    const timer = setTimeout(() => {
      if (initialVersion !== requestVersion.current) return
      setShowReport(false)
      if (autoVerify) void verify()
      else setUi({ kind: 'idle' })
    }, 0)
    return () => {
      clearTimeout(timer)
      if (resetTimer.current) clearTimeout(resetTimer.current)
      requestVersion.current += 1
    }
  }, [autoVerify, verify])

  const openMismatchReport = () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    setShowReport(true)
  }

  const statusAriaLabel = ariaLabel?.replace(/^Verify integrity/, 'Integrity verification')
  const reCheckAriaLabel = ariaLabel?.replace(/^Verify integrity/, 'Re-check integrity')
  const reCheckButton = (
    <button
      type="button"
      onClick={() => void verify(true)}
      aria-label={reCheckAriaLabel}
      className="mt-[4px] flex items-center gap-[4px] text-[10px] font-[500] text-chain opacity-60 transition-opacity hover:opacity-100"
    >
      <Ic n="hex" s={9} className="text-chain" />
      Re-check
    </button>
  )

  if (ui.kind === 'verifying') {
    return (
      <div ref={pendingRef} tabIndex={-1} role="status" aria-live="polite" aria-label={statusAriaLabel} className={`mt-2 flex items-center gap-[6px] rounded-[var(--r-md)] bg-surf-high px-[8px] py-[6px] text-[11px] font-[500] text-on-surf-v ${className}`}>
        <SpinnerRing />
        Checking blockchain integrity…
      </div>
    )
  }

  if (ui.kind === 'result') {
    const r = ui.result

    if (r.status === 'verified') {
      const isPhaseReceipt = subjectType === 'phase_event'
      return (
        <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" aria-label={statusAriaLabel} className={`mt-2 ${className}`}>
          <div className="rounded-[var(--r-md)] bg-ok-c px-[10px] py-[8px]">
            <div className="flex items-center gap-[6px] text-[12px] font-[700] text-on-ok-c">
              <Ic n="shield" s={13} className="text-ok" />
              {subjectType === 'trip' ? 'Committed trip details match' : isPhaseReceipt ? 'Phase receipt matches' : 'Selected record matches'}
            </div>
            <div className="mt-[4px] text-[11px] leading-snug text-on-ok-c/80">
              {subjectType === 'trip'
                ? 'Committed trip details match their anchor. Photos, scans and other evidence are not covered by this check.'
                : isPhaseReceipt
                  ? r.evidence_verified
                    ? 'The phase fields and linked evidence bytes match their blockchain commitment.'
                    : 'The phase fields match their anchor. This legacy receipt did not commit evidence bytes, so linked files were not checked.'
                  : 'The selected record matches its blockchain anchor.'}
              <div>Checked {fmtDateTime(ui.checkedAt)}</div>
            </div>
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'db_mismatch' || r.status === 'hedera_mismatch') {
      return (
        <div ref={resultRef} tabIndex={-1} role="alert" aria-label={statusAriaLabel} className={`mt-2 ${className}`}>
          <>
            {showReport && <MismatchReport result={r} onClose={() => setShowReport(false)} />}
          </>
          <div className="rounded-[var(--r-md)] bg-err-c px-[10px] py-[8px]">
            <div className="flex items-center gap-[6px] text-[12px] font-[700] text-on-err-c">
              <Ic n="warn" s={13} className="text-err" />
              Mismatch Detected
            </div>
            <div className="mt-[4px] text-[11px] leading-snug text-on-err-c/80">
              {r.status === 'db_mismatch'
                ? 'The current off-chain record or linked evidence does not match its committed receipt.'
                : 'The Hedera record does not match the expected receipt hash.'}
            </div>
            <>
              <button
                type="button"
                onClick={openMismatchReport}
                className="mt-[6px] flex items-center gap-[5px] rounded-[var(--r-sm)] border border-err/30 bg-err/10 px-[8px] py-[4px] text-[10px] font-[600] text-on-err-c transition-colors hover:bg-err/20"
              >
                <Ic n="file" s={10} className="text-on-err-c" />
                View Mismatch Report
              </button>
            </>
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'error') {
      return (
        <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" aria-label={statusAriaLabel} className={`mt-2 ${className}`}>
          <div className="flex items-center gap-[6px] rounded-[var(--r-md)] bg-warn-c px-[10px] py-[7px]">
            <Ic n="warn" s={12} className="text-warn" />
            <div>
              <div className="text-[11px] font-[700] text-on-warn-c">Verification could not be completed</div>
              <div className="mt-[1px] text-[10px] text-on-warn-c/70">Review the receipt or try again later</div>
            </div>
          </div>
          {reCheckButton}
        </div>
      )
    }

    // no_receipt
    return (
      <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" aria-label={statusAriaLabel} className={`mt-2 ${className}`}>
        <div className="text-[11px] font-[500] text-chain-onc opacity-60">
          No anchor on file for this record
        </div>
        {reCheckButton}
      </div>
    )
  }

  // idle — manual mode only
  return (
    <button
      ref={idleButtonRef}
      type="button"
      onClick={() => void verify(true)}
      aria-label={ariaLabel}
      className={`mt-2 flex w-full items-center justify-center gap-[5px] rounded-[var(--r-md)] border border-chain/30 bg-chain/10 px-[10px] py-[5px] text-[11px] font-[600] text-chain transition-all duration-[120ms] hover:bg-chain/15 active:scale-[0.97] ${className}`}
    >
      <Ic n="hex" s={11} className="text-chain" />
      Verify integrity
    </button>
  )
}
