import { Clock } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'

interface TimestampWithIconProps {
  timestamp: string
  className?: string
}

/**
 * Formats an ISO 8601 timestamp as "HH:MM SAST · DD Mon YYYY", from the same helper as every
 * other date in the app. Clock icon uses secondary colour; text stays on-surface for WCAG compliance.
 */
export function TimestampWithIcon({ timestamp, className }: TimestampWithIconProps) {
  const parts = fmtSastDateParts(timestamp)

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-surface-on', className)}>
      <Clock className="w-3.5 h-3.5 text-secondary shrink-0" />
      <span>
        {parts ? `${parts.time} · ${parts.day}` : '—'}
      </span>
    </span>
  )
}
