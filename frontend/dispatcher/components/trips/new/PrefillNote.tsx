'use client'

import { X } from 'lucide-react'

import type { PrefillNotice } from '@/lib/trips/useTripPrefill'

export const PREFILL_COPY = {
  filled: 'Filled in by the assistant. Check everything before creating the trip.',
  leftBlank: "Some values weren't recognised and were left blank.",
  dismiss: 'Dismiss',
} as const

/** The note at the top of the form after the assistant's "Open trip form" (assistant spec §7.3). */
export function PrefillNote({ notice, onDismiss }: { notice: PrefillNotice; onDismiss: () => void }) {
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-sec/30 bg-sec-c/40 px-4 py-3 text-[13px] text-on-surf">
      <p>
        {PREFILL_COPY.filled}
        {notice.leftBlank && <span className="font-[600]"> {PREFILL_COPY.leftBlank}</span>}
      </p>
      <button type="button" onClick={onDismiss} aria-label={PREFILL_COPY.dismiss} className="rounded-md p-0.5 text-on-surf-v hover:bg-surf-low">
        <X size={16} aria-hidden />
      </button>
    </div>
  )
}
