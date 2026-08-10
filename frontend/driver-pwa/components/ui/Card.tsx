import { type ReactNode, type KeyboardEvent } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const cardVariants = cva('rounded-xl p-5', {
  variants: {
    variant: {
      default:   'bg-surface-container-lowest shadow-ambient',
      exception: 'bg-surface-container-lowest shadow-ambient border-l-4 border-error',
      selected:  'bg-secondary-fixed shadow-ambient-sm',
      section:   'bg-surface-container-low',
      dark:      'bg-primary text-primary-on shadow-ambient',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

// Per-variant hover — kept separate from cardVariants so it's only applied when
// interactive, but still scoped to the variant (a flat hover override appended
// via className loses the cascade to this same-specificity base class).
const hoverClasses: Record<NonNullable<VariantProps<typeof cardVariants>['variant']>, string> = {
  default:   'hover:bg-surface-container-high',
  exception: 'hover:bg-surface-container-high',
  selected:  'hover:bg-surface-container-high',
  section:   'hover:bg-surface-container-high',
  dark:      'hover:bg-primary/90',
}

interface CardProps extends VariantProps<typeof cardVariants> {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ variant = 'default', children, className, onClick }: CardProps) {
  const isInteractive = onClick !== undefined
  const resolvedVariant = variant ?? 'default'

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') onClick?.()
  }

  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
      className={cn(
        cardVariants({ variant }),
        isInteractive && cn('cursor-pointer transition-colors duration-150', hoverClasses[resolvedVariant]),
        className,
      )}
    >
      {children}
    </div>
  )
}
