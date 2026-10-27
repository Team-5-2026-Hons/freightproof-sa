'use client'

import { StatusBanner } from '@/components/ui/StatusBanner'

export function HoldNotice({ className }: { className?: string }) {
  return (
    <StatusBanner tone="attention" title="Trip on hold" className={className}>
      A critical exception was recorded and this trip is paused for dispatcher review.
      Follow your dispatcher&rsquo;s instructions. No further phase steps can be
      submitted until the hold is resolved.
    </StatusBanner>
  )
}
