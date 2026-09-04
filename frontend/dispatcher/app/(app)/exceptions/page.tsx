'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { SecHead }    from '@/components/ui/SecHead'
import { Chip }       from '@/components/ui/Chip'
import { Ic }         from '@/components/ui/Ic'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner }    from '@/components/ui/Spinner'
import { Button }     from '@/components/ui/Button'
import { useExceptions } from '@/lib/hooks/useExceptions'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { COPY }   from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'
import { cn }     from '@shared/lib/utils/cn'

function fmtType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

// Left-border accent per severity — draws the eye to high-priority items
const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-4 border-err',
  warning:  'border-l-4 border-warn',
  info:     'border-l-4 border-outline-v/30',
}

export default function ExceptionsPage() {
  const router = useRouter()
  const [showResolved, setShowResolved] = useState(false)

  // One fetch, not three. This page previously called the hook once per tab plus once
  // for the visible list; against a real API that is three round trips for one screen,
  // and the two counts are derivable from the same rows. Fetching everything and
  // splitting here also keeps the tab counts consistent with the list — three separate
  // requests could land in any order and disagree.
  const { exceptions: all, isLoading, error, refetch } = useExceptions()

  const openCount   = useMemo(() => all.filter(e => !e.resolved).length, [all])
  const closedCount = all.length - openCount
  const exceptions  = useMemo(
    () => all.filter(e => e.resolved === showResolved),
    [all, showResolved],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Exceptions"
        sub={`${openCount} open · ${closedCount} resolved`}
      />

      {/* Underline tab toggle */}
      <div className="flex px-6 pt-5 shrink-0">
        {(['Open Issues', 'Resolved'] as const).map((label, i) => {
          const active = i === 0 ? !showResolved : showResolved
          return (
            <button
              key={label}
              onClick={() => setShowResolved(i === 1)}
              className={cn(
                'px-4 pb-3 text-[13px] font-[600] border-b-2 transition-colors duration-150',
                active
                  ? 'border-sec text-sec'
                  : 'border-transparent text-on-surf-v hover:text-on-surf',
              )}
            >
              {label}
              {i === 0 && openCount > 0 && (
                <span className="ml-1.5 bg-err text-white text-[10px] font-[700] rounded-sm px-[5px] py-[1px]">
                  {openCount}
                </span>
              )}
            </button>
          )
        })}
        {/* Underline fills remaining width */}
        <div className="flex-1 border-b-2 border-outline-v/20" />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="mx-6 my-5">
          {/* A background refresh failed while rows were already on screen. The list below
              is still shown — it is real data, just possibly stale — but the dispatcher has
              to know it stopped updating, or they will read a queue that silently froze
              during an incident and believe it is current. */}
          {error && all.length > 0 && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-warn-c px-5 py-3">
              <div className="flex items-center gap-[9px]">
                <Ic n="warn" s={14} className="text-warn-onc shrink-0" />
                <span className="text-[12px] font-[600] text-warn-onc">
                  This list may be out of date — the last refresh failed.
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={refetch}>Retry</Button>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : error && all.length === 0 ? (
            /* Ranked ahead of the empty state deliberately. "No exceptions" is the most
               reassuring thing this screen can say, and saying it because a fetch failed
               would be the worst error this page could make.

               Gated on having nothing to show. The hook refetches on EVERY trip event in
               the organisation, so a single blip on a background refresh would otherwise
               replace a fully-loaded queue with an error page — throwing away good rows
               the dispatcher was reading because an unrelated refresh failed. With rows
               in hand the stale list stays up and the banner below carries the warning. */
            <div className="bg-surf-lowest rounded-lg shadow-level-3 p-10">
              <EmptyState
                icon={<Ic n="warn" s={32} className="text-err" />}
                title="Could not load exceptions"
                body={error}
                cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
              />
            </div>
          ) : exceptions.length === 0 ? (
            <div className="bg-surf-lowest rounded-lg shadow-level-3 p-10">
              <EmptyState
                icon={
                  showResolved
                    ? <Ic n="check" s={32} className="text-on-surf-v" />
                    : <Ic n="warn"  s={32} className="text-on-surf-v" />
                }
                title={showResolved ? 'No resolved exceptions' : COPY.emptyState.allClear.title}
                body={showResolved ? 'No exceptions have been resolved yet.' : COPY.emptyState.allClear.body}
              />
            </div>
          ) : (
            <div className="bg-surf-lowest rounded-lg shadow-level-3 overflow-hidden">
              <SecHead title={showResolved ? 'Resolved Exceptions' : 'Open Exceptions'} />

              {/* Column header */}
              <div className="flex items-center gap-4 px-6 py-[7px] bg-surf-low border-b border-outline-v/10 select-none">
                <div className="w-[80px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Severity</div>
                <div className="w-[200px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Type · Source</div>
                <div className="flex-1 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Description</div>
                <div className="w-[110px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Trip</div>
                <div className="w-[110px] shrink-0 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">Raised</div>
                <div className="w-[48px] shrink-0" />
              </div>

              <div className="divide-y divide-outline-v/10">
                {exceptions.map(exc => {
                  const sevMeta = EXCEPTION_SEVERITY_META[exc.severity]
                  const srcMeta = EXCEPTION_SOURCE_META[exc.source]

                  return (
                    <div
                      key={exc.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(ROUTES.exceptionDetail(exc.id))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ')
                          router.push(ROUTES.exceptionDetail(exc.id))
                      }}
                      className={cn(
                        'flex items-center gap-4 px-6 py-[14px] cursor-pointer',
                        'bg-surf-lowest transition-colors duration-[120ms] hover:bg-surf-low',
                        SEVERITY_BORDER[exc.severity],
                      )}
                    >
                      {/* Severity */}
                      <div className="w-[80px] shrink-0">
                        <Chip type={sevMeta.chipType} label={sevMeta.label} />
                      </div>

                      {/* Type + source */}
                      <div className="w-[200px] shrink-0 min-w-0">
                        <div className="text-[13px] font-[700] text-on-surf leading-tight truncate">
                          {fmtType(exc.exception_type)}
                        </div>
                        <div className="text-[11px] text-on-surf-v mt-[2px]">
                          {srcMeta.label}
                        </div>
                      </div>

                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-on-surf-v truncate">{exc.description}</p>
                      </div>

                      {/* Trip ref */}
                      <div className="w-[110px] shrink-0 text-[12px] font-[600] text-sec tabular-nums tracking-[0.04em] truncate">
                        {exc.trip_reference ?? '—'}
                      </div>

                      {/* Timestamp */}
                      <div className="w-[110px] shrink-0 flex items-center gap-1 text-[11px] font-[500] text-sec tabular-nums">
                        <Ic n="clock" s={10} className="text-sec shrink-0" />
                        {fmtTs(exc.created_at)}
                      </div>

                      {/* View */}
                      <div className="w-[48px] shrink-0 flex justify-end">
                        <span className="flex items-center gap-0.5 text-[12px] font-[600] text-sec">
                          View <Ic n="chev" s={13} className="text-sec" />
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
