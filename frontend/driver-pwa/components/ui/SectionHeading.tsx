import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeadingProps {
  title: string
  /** A trailing control such as "See all" — sits on the heading's baseline row. */
  action?: ReactNode
  /** For aria-labelledby on the section this heading names. */
  id?: string
  className?: string
}

/**
 * The bold section title that structures every overhaul screen ("Route", "Upcoming",
 * "Preferences"). Hierarchy comes from this weight and size on a white page, not from
 * boxing each section in a card — the move that made the old screens read as dated.
 */
export function SectionHeading({ title, action, id, className }: SectionHeadingProps) {
  return (
    // Wraps at the large accessibility text sizes, so the action drops under the title
    // instead of being pushed off the edge of the screen.
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5', className)}>
      <h2 id={id} className="min-w-0 text-title-2 tracking-tight text-surface-on">
        {title}
      </h2>
      {action}
    </div>
  )
}
