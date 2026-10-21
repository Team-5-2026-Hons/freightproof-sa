import type { ReactNode } from 'react'
import { RecordLink } from '@/components/ui/RecordLink'
import { SecHead } from '@/components/ui/SecHead'
import { cn } from '@shared/lib/utils/cn'

interface DashboardPanelProps {
  title: string
  /** The whole backlog, e.g. "64 need review": never the capped number of rows shown, which would
   *  read as the total being smaller. Null while loading or failed, when a count would be a guess. */
  count: string | null
  noun: string
  viewAllHref: string
  children: ReactNode
  /** Lets a panel take the height left over by its neighbours instead of sizing to its rows. */
  className?: string
}

/** The card shared by the dashboard's summary panels: title, how many need attention, a way to the
 *  full page, then the panel's own body. */
export function DashboardPanel({ title, count, noun, viewAllHref, children, className }: DashboardPanelProps): React.JSX.Element {
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg bg-surf-lowest shadow-level-3', className)}>
      <SecHead
        title={title}
        meta={
          <div className="flex items-center gap-3 whitespace-nowrap">
            {count !== null && (
              <span aria-live="polite" className="text-[11px] font-semibold text-on-surf-v">
                {count}
              </span>
            )}
            <RecordLink href={viewAllHref} className="!min-h-0 text-[12px]">
              {/* The title beside it names the noun on screen; the full name is kept for assistive tech. */}
              View all<span className="sr-only"> {noun}</span>
            </RecordLink>
          </div>
        }
      />
      {children}
    </section>
  )
}
