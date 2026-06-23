import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface CardProps {
  variant?: 'default' | 'exception' | 'selected' | 'section' | 'dark'
  children: ReactNode
  className?: string
  onClick?: () => void
}

const variantClasses: Record<NonNullable<CardProps['variant']>, string> = {
  default:   'bg-surface-container-lowest shadow-ambient',
  exception: 'bg-surface-container-lowest shadow-ambient border-l-4 border-error',
  selected:  'bg-secondary-fixed shadow-ambient-sm',
  section:   'bg-surface-container-low',
  dark:      'bg-primary text-primary-on shadow-ambient',
}

// Per-variant hover — kept out of variantClasses so it's only applied when
// interactive, but still scoped to the variant (a flat hover override appended
// via className loses the cascade to this same-specificity base class).
const hoverClasses: Record<NonNullable<CardProps['variant']>, string> = {
  default:   'hover:bg-surface-container-high',
  exception: 'hover:bg-surface-container-high',
  selected:  'hover:bg-surface-container-high',
  section:   'hover:bg-surface-container-high',
  dark:      'hover:bg-primary/90',
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
        isInteractive && cn('cursor-pointer transition-colors duration-150', hoverClasses[variant]),
        className,
      )}
    >
      {children}
    </div>
  )
}
