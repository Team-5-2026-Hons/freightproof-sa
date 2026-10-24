import { Children, isValidElement, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionHeading } from './SectionHeading'

interface ListSectionProps {
  title?: string
  action?: ReactNode
  /**
   * Where the rule between rows starts: under the text column when rows lead with an
   * icon (20 gutter + 24 icon + 16 gap = 60px), or at the gutter when they don't.
   */
  inset?: 'icon' | 'text'
  className?: string
  children: ReactNode
}

/**
 * A titled run of flat rows on the white page, separated by inset hairlines — the
 * Uber/iOS list, replacing the old shadowed card around every group.
 */
export function ListSection({ title, action, inset = 'icon', className, children }: ListSectionProps) {
  // Falsy children ({cond && <ListRow/>}) are dropped before the rules are interleaved,
  // so a hidden row never leaves a doubled rule behind.
  const rows = Children.toArray(children).filter(isValidElement)
  return (
    <section className={className}>
      {title !== undefined && <SectionHeading title={title} action={action} className="mb-1" />}
      {rows.map((row, i) => (
        <div key={row.key ?? i}>
          {i > 0 && (
            <div
              data-list-rule
              aria-hidden
              className={cn('h-px bg-hairline', inset === 'icon' ? 'ml-[60px]' : 'ml-5')}
            />
          )}
          {row}
        </div>
      ))}
    </section>
  )
}

const EXTERNAL_HREF = /^(mailto:|tel:|https?:)/

interface ListRowProps {
  icon?: ReactNode
  /** Small secondary text above the value ("Seal", "Departed 10:02"). */
  label?: ReactNode
  value: ReactNode
  /** Secondary line under the value. */
  detail?: ReactNode
  /**
   * Right-hand content. Must be non-interactive when the row itself is a link or button —
   * a control nested inside a control is unreachable for screen readers.
   */
  trailing?: ReactNode
  href?: string
  onClick?: () => void
  /** Show a chevron after `trailing`; defaults to on for link rows. */
  chevron?: boolean
  className?: string
}

/** One row: optional icon column, label over value, trailing detail. */
export function ListRow({ icon, label, value, detail, trailing, href, onClick, chevron, className }: ListRowProps) {
  const showChevron = chevron ?? href !== undefined
  const body = (
    <>
      {icon !== undefined && (
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-surface-on">
          {icon}
        </span>
      )}
      {/* basis-24 + the row's flex-wrap: the text column keeps room for a word or two, and a
          trailing value that cannot fit beside it drops onto its own line instead of
          overprinting the label. break-words: an unbreakable string (an email address) wraps
          inside the column rather than running on into the chevron. */}
      <span className="min-w-0 flex-1 basis-24 break-words">
        {label !== undefined && <span className="block text-subhead text-surface-on-variant">{label}</span>}
        <span className="block text-body text-surface-on">{value}</span>
        {detail !== undefined && <span className="block text-footnote text-surface-on-variant">{detail}</span>}
      </span>
      {trailing !== undefined && <span className="ml-auto shrink-0 text-body text-surface-on-variant">{trailing}</span>}
      {showChevron && <ChevronRight aria-hidden className="size-4 shrink-0 text-outline" strokeWidth={2.25} />}
    </>
  )
  const layout = cn(
    'flex min-h-[56px] w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left',
    (href !== undefined || onClick !== undefined) && 'transition-colors duration-100 active:bg-fill',
    className,
  )

  if (href !== undefined) {
    // mailto:/tel:/https: leave the app; the client router must not try to prefetch them.
    if (EXTERNAL_HREF.test(href)) return <a href={href} className={layout}>{body}</a>
    return <Link href={href} className={layout}>{body}</Link>
  }
  if (onClick !== undefined) {
    return <button type="button" onClick={onClick} className={layout}>{body}</button>
  }
  return <div className={layout}>{body}</div>
}
