import { ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import type { ReactNode } from 'react'

interface ExceptionBannerProps {
  title: string
  description: string
  action?: ReactNode
  className?: string
}

/**
 * Error-severity banner — error-container background, left red border, ShieldAlert icon.
 * Used for seal breaks, mismatches, and critical failures per DESIGN_SYSTEM.md §9.1.
 */
export function ExceptionBanner({ title, description, action, className }: ExceptionBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 p-4 rounded-xl',
        'bg-error-container border-l-4 border-error',
        className,
      )}
    >
      <ShieldAlert className="w-5 h-5 text-error shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-error-on-container">{title}</p>
        <p className="text-xs text-error-on-container/80 mt-0.5 leading-relaxed">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
