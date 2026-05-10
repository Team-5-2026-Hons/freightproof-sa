import { cn } from '@shared/lib/utils/cn'

interface SkeletonProps {
  variant?: 'text' | 'block' | 'card'
  lines?: number
  className?: string
}

// Shimmer is a CSS animation — collapsed by the prefers-reduced-motion rule in globals.css,
// leaving a static block that still communicates "loading" without motion.
export function Skeleton({ variant = 'text', lines = 1, className }: SkeletonProps) {
  if (variant === 'card') {
    return (
      <div className={cn('animate-pulse rounded-xl border-2 border-outline bg-surface-container-low p-6', className)}>
        <div className="mb-3 h-4 w-1/3 rounded-md bg-surface-container-high" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded-md bg-surface-container-high" />
          <div className="h-3 w-4/5 rounded-md bg-surface-container-high" />
        </div>
      </div>
    )
  }

  if (variant === 'block') {
    return (
      <div
        className={cn('animate-pulse rounded-md bg-surface-container-high', className)}
        aria-hidden="true"
      />
    )
  }

  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'animate-pulse h-3 rounded-md bg-surface-container-high',
            i === lines - 1 && lines > 1 ? 'w-4/5' : 'w-full',
          )}
        />
      ))}
    </div>
  )
}
