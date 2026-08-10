'use client'

import { cn } from '@shared/lib/utils/cn'

interface SkeletonProps {
  variant?: 'text' | 'block' | 'card'
  lines?: number
  className?: string
}

export function Skeleton({ variant = 'block', lines = 1, className }: SkeletonProps) {
  // Shimmer animation is suppressed automatically via globals.css prefers-reduced-motion rule.
  const base = 'bg-surface-container-high animate-pulse rounded-xl'

  if (variant === 'text') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(base, 'h-4', i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full')}
          />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div className={cn(base, 'p-5 flex flex-col gap-3', className)}>
        <div className="h-4 w-1/3 bg-surface-container-highest rounded-full" />
        <div className="h-6 w-2/3 bg-surface-container-highest rounded-full" />
        <div className="h-4 w-full bg-surface-container-highest rounded-full mt-2" />
        <div className="h-4 w-4/5 bg-surface-container-highest rounded-full" />
      </div>
    )
  }

  return <div className={cn(base, 'h-10', className)} />
}
