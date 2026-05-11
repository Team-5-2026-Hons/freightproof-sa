import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface CardProps {
  variant?: 'default' | 'exception' | 'selected' | 'section'
  children: ReactNode
  className?: string
  onClick?: () => void
}

const variantClasses: Record<NonNullable<CardProps['variant']>, string> = {
  default:   'bg-surface-container-lowest shadow-ambient',
  exception: 'bg-surface-container-lowest shadow-ambient border-l-4 border-error',
  selected:  'bg-secondary-fixed shadow-ambient-sm',
  section:   'bg-surface-container-low',
}

export function Card({ variant = 'default', children, className, onClick }: CardProps) {
  const isInteractive = onClick !== undefined
  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }
          : undefined
      }
      className={cn(
        'rounded-xl p-5',
        variantClasses[variant],
        isInteractive && 'cursor-pointer hover:bg-surface-container-high transition-colors duration-150',
        className,
      )}
    >
      {children}
    </div>
  )
}
