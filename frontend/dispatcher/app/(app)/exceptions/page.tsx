'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { SecHead }    from '@/components/ui/SecHead'
import { Chip }       from '@/components/ui/Chip'
import { Ic }         from '@/components/ui/Ic'
import { EmptyState } from '@/components/ui/EmptyState'
import { useExceptions } from '@/lib/hooks/useExceptions'
import { mockTrips }     from '@shared/lib/mocks/trips'
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

  const exceptions  = useExceptions({ resolved: showResolved })
  const openCount   = useExceptions({ resolved: false }).length
  const closedCount = useExceptions({ resolved: true }).length

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
          {exceptions.length === 0 ? (
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
                  const trip    = mockTrips.find(t => t.id === exc.trip_id)

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
                        {trip?.trip_reference ?? '—'}
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
