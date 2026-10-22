'use client'

import { StatusBanner } from '@/components/ui/StatusBanner'

// Shown wherever the driver would otherwise get a phase CTA while
// trip.status === 'exception_hold' (e.g. after a seal mismatch). The trip is
// paused for dispatcher review — offering the next phase here would only
// produce 409s the driver can't act on.
//
// Amber, as on Home's hold card: the exception is already recorded and
// nothing is failing right now, so red would say the wrong thing.
export function HoldNotice({ className }: { className?: string }) {
  return (
    <StatusBanner tone="attention" title="Trip on hold" className={className}>
      A critical exception was recorded and this trip is paused for dispatcher review.
      Follow your dispatcher&rsquo;s instructions — no further phase steps can be
      submitted until the hold is resolved.
    </StatusBanner>
  )
}
