'use client'

// On-demand verify button that POSTs to /api/v1/blockchain/verify and renders
// the result inline. Auto-resets to idle after 7 s so the user can re-verify.
// Accepts an authHeader prop so dispatcher (JWT Bearer) and driver-pwa can both use it.

import { useState } from 'react'
import type { SubjectType, VerifyResult } from '@shared/lib/types/blockchain'

type Props = {
  subjectType: SubjectType
  subjectId: string
  /** Override the API base URL — defaults to NEXT_PUBLIC_API_BASE_URL or localhost:8000. */
  apiBase?: string
  /** Full Authorization header value, e.g. "Bearer <token>". Omit for unauthenticated calls. */
  authHeader?: string
  onResult?: (r: VerifyResult) => void
  className?: string
}

type UIState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'result'; result: VerifyResult }

// Env var resolved at module init; falls back to local dev server.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

export function VerifyButton({
  subjectType, subjectId, apiBase = API_BASE, authHeader, onResult, className = '',
}: Props) {
  const [ui, setUi] = useState<UIState>({ kind: 'idle' })

  async function verify() {
    setUi({ kind: 'verifying' })
    const resp = await fetch(`${apiBase}/api/v1/blockchain/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId }),
    })
    const result = (await resp.json()) as VerifyResult
    setUi({ kind: 'result', result })
    onResult?.(result)
    // Reset to idle after 7 s so the user can trigger another verify without a page reload.
    setTimeout(() => setUi({ kind: 'idle' }), 7000)
  }

  if (ui.kind === 'verifying') {
    return (
      <button disabled className={`rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/70 ${className}`}>
        Verifying against Hedera…
      </button>
    )
  }
  if (ui.kind === 'result') {
    const r = ui.result
    if (r.status === 'verified') {
      return (
        <span className={`inline-flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ${className}`}>
          ✓ Verified — DB matches Hedera anchor
        </span>
      )
    }
    if (r.status === 'db_mismatch') {
      return (
        <div className={`rounded-md bg-red-500/15 p-3 text-xs text-red-200 ${className}`}>
          <div className="font-semibold">⚠ MISMATCH — DB has been modified since anchoring</div>
          <div className="mt-1 opacity-80 font-mono">
            <div>Expected: {r.expected_hash}</div>
            <div>Current:  {r.current_hash}</div>
          </div>
        </div>
      )
    }
    if (r.status === 'hedera_mismatch') {
      return (
        <span className={`inline-flex items-center gap-2 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 ${className}`}>
          ⚠ Hedera record mismatch — escalate
        </span>
      )
    }
    return (
      <span className={`inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/60 ${className}`}>
        No anchor on file — cannot verify
      </span>
    )
  }
  return (
    <button
      onClick={verify}
      className={`rounded-md bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 ${className}`}
    >
      Verify Now
    </button>
  )
}
