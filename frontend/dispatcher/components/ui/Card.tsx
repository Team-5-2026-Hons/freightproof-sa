import { cn } from '@shared/lib/utils/cn'

interface CardProps {
  variant?: 'default' | 'exception' | 'selected'
  className?: string
  children: React.ReactNode
}

const variantClass = {
  default:   'bg-surface-container-lowest border-2 border-outline',
  // Left accent communicates exception state semantically, not just by colour.
  exception: 'bg-surface-container-lowest border-2 border-outline border-l-[3px] border-l-error',
  selected:  'bg-secondary-container border-2 border-outline',
}

export function Card({ variant = 'default', className, children }: CardProps) {
  return (
    <div className={cn('rounded-xl', variantClass[variant], className)}>
      {children}
    </div>
  )
}
