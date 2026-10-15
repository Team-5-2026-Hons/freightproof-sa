import { type ReactNode, type KeyboardEvent } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const cardVariants = cva('rounded-xl p-5', {
  variants: {
    variant: {
      default:   'bg-surface-container-lowest shadow-ambient',
      // Tinted, not a thick coloured left border — that stripe is a stock template tell,
      // and the tint carries the same "this is an alert" meaning across the whole card.
      exception: 'bg-error-container/60 text-error-on-container',
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
        // active: as well as hover: — a phone has no hover, so a tappable card needs its
        // own press response the instant the finger lands, not on the next screen's paint.
        isInteractive && cn(
          'cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.98]',
          hoverClasses[resolvedVariant],
        ),
        className,
      )}
    >
      {children}
    </div>
  )
}
