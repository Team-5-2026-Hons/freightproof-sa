'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { Ic } from '@/components/ui/Ic'
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

export function VerifyButton({
  subjectType, subjectId, autoVerify = false, onResult, className = '',
}: Props) {
  // Start in 'verifying' immediately when auto-mode so no button flash before the effect fires.
  const [ui, setUi] = useState<UIState>(autoVerify ? { kind: 'verifying' } : { kind: 'idle' })

  const verify = useCallback(async () => {
    setUi({ kind: 'verifying' })
    try {
      const result = await api.post<VerifyResult>('/api/v1/blockchain/verify', {
        subject_type: subjectType,
        subject_id: subjectId,
      })
      setUi({ kind: 'result', result })
      onResult?.(result)
      // Manual verifies auto-reset after 8s; auto-verify results stay visible.
      if (!autoVerify) {
        setTimeout(() => setUi({ kind: 'idle' }), 8000)
      }
    } catch {
      setUi(autoVerify ? { kind: 'idle' } : { kind: 'idle' })
    }
  }, [subjectType, subjectId, autoVerify, onResult])

  // Fire once after the page has rendered — non-blocking.
  useEffect(() => {
    if (autoVerify) verify()
  }, [autoVerify, verify])

  const reCheckButton = autoVerify ? (
    <button
      onClick={verify}
      className="mt-[4px] flex items-center gap-[4px] text-[10px] font-[500] text-chain opacity-60 hover:opacity-100 transition-opacity"
    >
      <Ic n="hex" s={9} className="text-chain" />
      Re-check
    </button>
  ) : null

  if (ui.kind === 'verifying') {
    return (
      <div className={`mt-2 flex items-center gap-[5px] text-[11px] font-[500] tracking-[0.03em] text-chain-onc opacity-70 ${className}`}>
        <Ic n="hex" s={10} className="text-chain animate-pulse" />
        Checking integrity…
      </div>
    )
  }

  if (ui.kind === 'result') {
    const r = ui.result

    if (r.status === 'verified') {
      return (
        <div className={`mt-2 ${className}`}>
          <div className="flex items-center gap-[5px] rounded-[var(--r-md)] bg-ok-c px-[8px] py-[5px] text-[11px] font-[600] text-on-ok-c">
            <Ic n="check" s={11} className="text-ok" />
            Verified — DB matches Hedera
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'db_mismatch') {
      return (
        <div className={`mt-2 ${className}`}>
          <div className="rounded-[var(--r-md)] bg-err-c p-[8px] text-[11px] text-on-err-c">
            <div className="flex items-center gap-[5px] font-[700]">
              <Ic n="warn" s={11} className="text-err" />
              Tamper detected
            </div>
            <div className="mt-[4px] font-mono text-[10px] tracking-[0.03em] opacity-80 break-all">
              Expected: {r.expected_hash?.slice(0, 16)}…
            </div>
            <div className="font-mono text-[10px] tracking-[0.03em] opacity-80 break-all">
              Current:&nbsp;&nbsp;{r.current_hash?.slice(0, 16)}…
            </div>
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'hedera_mismatch') {
      return (
        <div className={`mt-2 ${className}`}>
          <div className="flex items-center gap-[5px] rounded-[var(--r-md)] bg-err-c px-[8px] py-[5px] text-[11px] font-[600] text-on-err-c">
            <Ic n="warn" s={11} className="text-err" />
            Hedera mismatch — escalate
          </div>
          {reCheckButton}
        </div>
      )
    }

    if (r.status === 'error') {
      return (
        <div className={`mt-2 ${className}`}>
          <div className="flex items-center gap-[5px] rounded-[var(--r-md)] bg-warn-c px-[8px] py-[5px] text-[11px] font-[600] text-on-warn-c">
            <Ic n="warn" s={11} className="text-warn" />
            Hedera unavailable — check config
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
      className={`mt-2 w-full flex items-center justify-center gap-[5px] rounded-[var(--r-md)] border border-chain/30 bg-chain/10 px-[10px] py-[5px] text-[11px] font-[600] text-chain transition-all duration-[120ms] hover:bg-chain/15 active:scale-[0.97] ${className}`}
    >
      <Ic n="hex" s={11} className="text-chain" />
      Verify integrity
    </button>
  )
}
