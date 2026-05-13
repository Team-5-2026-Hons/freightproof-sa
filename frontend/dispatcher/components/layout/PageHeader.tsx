import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@shared/lib/utils/cn'

interface Breadcrumb {
  label: string
  href: string
}

interface PageHeaderProps {
  title: string
  /** Status chip or other inline element shown next to the title */
  badge?: ReactNode
  /** Breadcrumb trail — each entry becomes a link except the current page (shown as title) */
  breadcrumbs?: Breadcrumb[]
  /** Action buttons on the right side of the header */
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, badge, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-1 mb-6', className)}>
      {/* Breadcrumb */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-surface-on-variant">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3 h-3 text-outline" />}
              <Link
                href={crumb.href}
                className="hover:text-secondary transition-colors"
              >
                {crumb.label}
              </Link>
            </span>
          ))}
          <ChevronRight className="w-3 h-3 text-outline" />
          <span className="text-surface-on font-medium">{title}</span>
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[32px] font-extrabold text-surface-on leading-tight truncate">
            {title}
          </h1>
          {badge}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  )
}
