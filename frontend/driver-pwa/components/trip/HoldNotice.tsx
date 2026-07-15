'use client'

import { AlertTriangle } from 'lucide-react'

// Shown wherever the driver would otherwise get a handshake CTA while
// trip.status === 'exception_hold' (e.g. after an H4 seal mismatch). The trip is
// paused for dispatcher review — offering the next handshake here would only
// produce 409s the driver can't act on, the dead-end this component replaces.
export function HoldNotice({ className }: { className?: string }) {
  return (
    <div className={`flex gap-3 rounded-xl bg-error-container px-4 py-4 ${className ?? ''}`}>
      <AlertTriangle className="h-5 w-5 shrink-0 text-error-on-container" strokeWidth={2} aria-hidden />
      <div>
        <p className="text-sm font-bold text-error-on-container">Trip on hold</p>
        <p className="mt-1 text-sm text-error-on-container">
          A critical exception was recorded and this trip is paused for dispatcher review.
          Follow your dispatcher&rsquo;s instructions — no further handshake steps can be
          submitted until the hold is resolved.
        </p>
      </div>
    </div>
  )
}
