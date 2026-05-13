import { Clock } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface TimestampWithIconProps {
  timestamp: string
  className?: string
}

/**
 * Formats an ISO 8601 timestamp as "HH:MM · D Mon YYYY" in SAST.
 * Clock icon uses secondary colour; text stays on-surface for WCAG compliance.
 */
export function TimestampWithIcon({ timestamp, className }: TimestampWithIconProps) {
  const date = new Date(timestamp)

  const time = date.toLocaleTimeString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const day = date.toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-surface-on', className)}>
      <Clock className="w-3.5 h-3.5 text-secondary shrink-0" />
      <span>
        {time} · {day}
      </span>
    </span>
  )
}
