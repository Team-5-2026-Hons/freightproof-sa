import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeadingProps {
  title: string
  action?: ReactNode
  id?: string
  className?: string
}

/**
 * The bold section title that structures every screen ("Route", "Upcoming",
 * "Preferences"). Hierarchy comes from this weight and size on a white page, not from
 * boxing each section in a card — the move that made the old screens read as dated.
 */
export function SectionHeading({ title, action, id, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5', className)}>
      <h2 id={id} className="min-w-0 text-title-2 tracking-tight text-surface-on">
        {title}
      </h2>
      {action}
    </div>
  )
}
