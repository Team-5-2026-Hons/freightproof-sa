import type { ReactNode } from 'react'
import { InfoPopover } from '@/components/analytics/fleet/InfoPopover'
import { RecordLink } from '@/components/ui/RecordLink'
import { SecHead } from '@/components/ui/SecHead'
import { DASHBOARD_HELP, type DashboardHelpTopic } from '@/components/dashboard/dashboard-help-copy'
import { cn } from '@shared/lib/utils/cn'

interface DashboardPanelProps {
  title: string
  count: string | null
  noun: string
  viewAllHref: string
  help: DashboardHelpTopic
  children: ReactNode
  className?: string
}

/** The card shared by the dashboard's summary panels: title, how many need attention, a way to the
 *  full page, then the panel's own body. */
export function DashboardPanel({ title, count, noun, viewAllHref, help, children, className }: DashboardPanelProps): React.JSX.Element {
  const entry = DASHBOARD_HELP[help]
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg bg-surf-lowest shadow-level-3', className)}>
      <SecHead
        title={title}
        info={<InfoPopover title={entry.label} ariaLabel={entry.label} question={entry.question} basis={entry.basis} note={entry.note} footnote={entry.footnote} />}
        meta={
          <div className="flex items-center gap-3 whitespace-nowrap">
            {count !== null && (
              <span aria-live="polite" className="text-[11px] font-semibold text-on-surf-v">
                {count}
              </span>
            )}
            <RecordLink href={viewAllHref} className="!min-h-0 text-[12px]">
              View all<span className="sr-only"> {noun}</span>
            </RecordLink>
          </div>
        }
      />
      {children}
    </section>
  )
}
