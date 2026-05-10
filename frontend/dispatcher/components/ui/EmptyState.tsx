import type { LucideIcon } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  body: string
  cta?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, body, cta, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16 text-center', className)}>
      <Icon size={48} strokeWidth={1.5} className="text-surface-on-variant" aria-hidden="true" />
      <div className="max-w-sm space-y-2">
        <p className="text-[24px] font-semibold leading-8 text-surface-on">{title}</p>
        <p className="text-[14px] leading-5 text-surface-on-variant">{body}</p>
      </div>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  )
}
