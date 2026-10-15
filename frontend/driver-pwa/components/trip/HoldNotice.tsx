'use client'

import { StatusBanner } from '@/components/ui/StatusBanner'

// Shown wherever the driver would otherwise get a handshake CTA while
// trip.status === 'exception_hold' (e.g. after an H4 seal mismatch). The trip is
// paused for dispatcher review — offering the next handshake here would only
// produce 409s the driver can't act on, the dead-end this component replaces.
//
// Amber, as on Home's hold card (overhaul 2.4): the exception is already recorded and
// nothing is failing right now, so red would say the wrong thing.
export function HoldNotice({ className }: { className?: string }) {
  return (
    <StatusBanner tone="attention" title="Trip on hold" className={className}>
      A critical exception was recorded and this trip is paused for dispatcher review.
      Follow your dispatcher&rsquo;s instructions — no further handshake steps can be
      submitted until the hold is resolved.
    </StatusBanner>
  )
}
