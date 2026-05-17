'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { TopBar }         from '@/components/ui/TopBar'
import { StatCard }       from '@/components/ui/StatCard'
import { SecHead }        from '@/components/ui/SecHead'
import { Button }         from '@/components/ui/Button'
import { Spinner }        from '@/components/ui/Spinner'
import { Ic }             from '@/components/ui/Ic'
import { EmptyState }     from '@/components/ui/EmptyState'
import { ChecklistRow }   from '@/components/domain/ChecklistRow'
import type { ColWidths } from '@/components/domain/ChecklistRow'
import { useTrips }       from '@/lib/hooks/useTrips'
// ITERATION 2: re-enable exceptions — uncomment the two lines below
// import { useExceptions }  from '@/lib/hooks/useExceptions'
// import { mockTrips }      from '@shared/lib/mocks/trips'
import { usePrecincts }   from '@/lib/hooks/usePrecincts'
import { useToast }       from '@/lib/hooks/useToast'
import { ROUTES }         from '@/lib/constants/routes'
import { COPY }           from '@shared/lib/constants/copy'
import type { TripStatus } from '@shared/lib/types/trip'

const ACTIVE_STATUSES: TripStatus[] = [
  'created', 'origin_gate_in', 'loading', 'origin_gate_out',
  'in_transit', 'dest_gate_in', 'unloading', 'exception_hold',
]

type ColId = keyof ColWidths

const COL_HEADERS: { id: ColId | 'progress'; label: string }[] = [
  { id: 'tripId',   label: 'TRIP ID'        },
  { id: 'order',    label: 'ORDER'          },
  { id: 'driver',   label: 'DRIVER / HORSE' },
  { id: 'route',    label: 'ROUTE'          },
  { id: 'progress', label: 'PROGRESS'       },
  { id: 'status',   label: 'STATUS'         },
]

const INITIAL_COL_WIDTHS: ColWidths = {
  tripId: 155,
  order:  155,
  driver: 150,
  route:  130,
  status: 120,
}

const MIN_COL_W = 80

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ActiveTripsPage() {
  const router = useRouter()
  const { notify } = useToast()
  const [search, setSearch] = useState('')
  const [colWidths, setColWidths] = useState<ColWidths>(INITIAL_COL_WIDTHS)
  const resizeRef = useRef<{ id: ColId; startX: number; startW: number } | null>(null)

  // Single fetch for all trips — active and closed are derived client-side
  const { trips: allFetchedTrips, isLoading: tripsLoading, error: tripsError, refetch: refetchTrips } = useTrips()
  const { precincts } = usePrecincts()
  // ITERATION 2: const openExceptions = useExceptions({ resolved: false })

  useEffect(() => {
    if (tripsError) {
      notify({ kind: 'error', title: 'Failed to load trips', body: tripsError })
    }
  }, [tripsError, notify])

  const allTrips = useMemo(
    () => allFetchedTrips.filter(t => ACTIVE_STATUSES.includes(t.status)),
    [allFetchedTrips],
  )

  const closedTrips = useMemo(
    () => allFetchedTrips.filter(t => t.status === 'closed'),
    [allFetchedTrips],
  )

  const todayStr = new Date().toDateString()
  const completedCount = useMemo(
    () => closedTrips.filter(t => new Date(t.updated_at).toDateString() === todayStr).length,
    [closedTrips, todayStr],
  )

  const onTimePercent = useMemo(() => {
    const withArrival = allTrips.filter(t => t.actual_arrival_at && t.planned_arrival_at)
    if (withArrival.length === 0) return 100
    const onTime = withArrival.filter(
      t => new Date(t.actual_arrival_at!) <= new Date(t.planned_arrival_at!),
    )
    return Math.round((onTime.length / withArrival.length) * 100)
  }, [allTrips])

  // ITERATION 2: exception description for the dashboard banner
  // const exceptionDescription = useMemo(() => {
  //   return openExceptions.slice(0, 2).map(e => {
  //     const trip = mockTrips.find(t => t.id === e.trip_id)
  //     const ref  = trip?.trip_reference ?? 'Unknown'
  //     return `${ref}: ${e.exception_type.replace(/_/g, ' ')}`
  //   }).join(' · ')
  // }, [openExceptions])

  const filteredTrips = useMemo(() => {
    if (!search.trim()) return allTrips
    const term = search.toLowerCase()
    return allTrips.filter(t =>
      t.trip_reference.toLowerCase().includes(term) ||
      t.driver.full_name.toLowerCase().includes(term) ||
      t.order_number.toLowerCase().includes(term),
    )
  }, [allTrips, search])

  function startResize(id: ColId, e: React.MouseEvent) {
    e.preventDefault()
    resizeRef.current = { id, startX: e.clientX, startW: colWidths[id] }

    function onMove(ev: MouseEvent) {
      const r = resizeRef.current
      if (!r) return
      setColWidths(p => ({ ...p, [r.id]: Math.max(MIN_COL_W, r.startW + ev.clientX - r.startX) }))
    }

    function onUp() {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Dashboard"
        sub={`${formatDate(new Date())} · Load Factor Transport`}
      >
        <Button
          size="sm"
          iconLeft={<Ic n="plus" s={13} className="text-white" />}
          onClick={() => router.push(ROUTES.tripNew)}
        >
          New Trip
        </Button>
      </TopBar>

      {/* Stat strip — shows placeholders while trips are loading */}
      <div className="flex gap-3 px-6 py-4 bg-surf-low shrink-0">
        <StatCard value={tripsLoading ? '—' : String(allTrips.length)}       label="Active trips" />
        {/* ITERATION 2: <StatCard value={String(openExceptions.length)} label="Exceptions today" warn={openExceptions.length > 0} /> */}
        <StatCard value={tripsLoading ? '—' : String(completedCount)}         label="Completed today" />
        <StatCard value={tripsLoading ? '—' : `${onTimePercent}%`}            label="On-time rate (30d)" success={!tripsLoading && onTimePercent >= 90} warn={!tripsLoading && onTimePercent < 70} />
      </div>

      {/* Search */}
      <div className="px-6 py-3 shrink-0">
        <div className="relative">
          <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
          <input
            type="text"
            placeholder="Search trip ID, driver, or order…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
          />
        </div>
      </div>

      {/* Trip list card */}
      <div className="flex-1 overflow-hidden mx-6 mb-6 bg-surf-lowest rounded-lg shadow-level-3 flex flex-col">
        <SecHead
          title="Active Trips"
          action="New Trip"
          onAction={() => router.push(ROUTES.tripNew)}
        />

        {/* ITERATION 2: exception banner — uncomment block below and restore openExceptions/exceptionDescription */}
        {/* {openExceptions.length > 0 && (
          <div className="flex items-center gap-2 px-6 py-[7px] bg-err/8 border-b border-err/20 shrink-0">
            <Ic n="warn" s={13} className="text-err shrink-0" />
            <span className="text-[12px] font-[600] text-err">
              {openExceptions.length} exception{openExceptions.length > 1 ? 's' : ''} need review
            </span>
            {exceptionDescription && (
              <span className="text-[11px] text-err/60 truncate">· {exceptionDescription}</span>
            )}
            <button
              onClick={() => router.push(ROUTES.exceptions)}
              className="ml-auto text-[12px] font-[600] text-err hover:text-err/80 transition-colors shrink-0"
            >
              Review →
            </button>
          </div>
        )} */}

        {/* Table scroll area */}
        <div className="flex-1 overflow-auto">
          {tripsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : tripsError ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
              <AlertCircle className="w-10 h-10 text-error" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-bold text-surface-on">Failed to load trips</p>
                <p className="text-xs text-surface-on-variant">{tripsError}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={refetchTrips}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="min-w-[700px]">

              {/* Sticky column header */}
              <div className="sticky top-0 flex gap-3 px-6 py-[7px] bg-surf-low border-b border-outline-v/10 select-none">
                {COL_HEADERS.map(col =>
                  col.id === 'progress' ? (
                    <div key="progress" className="flex-1 text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
                      {col.label}
                    </div>
                  ) : (
                    <div
                      key={col.id}
                      style={{ width: colWidths[col.id as ColId], flexShrink: 0 }}
                      className="relative group text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v"
                    >
                      {col.label}
                      {/* Resize handle — hover to reveal, drag to resize */}
                      <div
                        onMouseDown={e => startResize(col.id as ColId, e)}
                        className="absolute right-0 top-0 h-full w-4 cursor-col-resize flex items-center justify-center"
                      >
                        <div className="w-[2px] h-3 rounded-full bg-outline-v/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Rows */}
              <div className="divide-y divide-outline-v/10">
                {allTrips.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<Ic n="truck" s={32} className="text-on-surf-v" />}
                      title={COPY.emptyState.activeTrips.title}
                      body={COPY.emptyState.activeTrips.body}
                    />
                  </div>
                ) : filteredTrips.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      icon={<Ic n="search" s={32} className="text-on-surf-v" />}
                      title={COPY.emptyState.noResults.title}
                      body={COPY.emptyState.noResults.body}
                    />
                  </div>
                ) : (
                  filteredTrips.map(trip => (
                    <ChecklistRow key={trip.id} trip={trip} colWidths={colWidths} precincts={precincts} />
                  ))
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
