import { type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface PageShellProps {
  children: ReactNode
  className?: string
}

/** Max-width centred container used by every page inside DispatcherShell. */
export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn('w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6', className)}>
      {children}
    </div>
  )
}
