import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  body: string
  cta?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, body, cta, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16 px-6 text-center', className)}>
      <span className="text-muted-foreground [&>svg]:w-12 [&>svg]:h-12">{icon}</span>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-bold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{body}</p>
      </div>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  )
}
