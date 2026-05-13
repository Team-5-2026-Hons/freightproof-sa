'use client'

import { useState, useMemo, useRef } from 'react'
import { TopBar }       from '@/components/ui/TopBar'
import { SecHead }      from '@/components/ui/SecHead'
import { Ic }           from '@/components/ui/Ic'
import { EmptyState }   from '@/components/ui/EmptyState'
import { ChecklistRow } from '@/components/domain/ChecklistRow'
import type { ColWidths } from '@/components/domain/ChecklistRow'
import { useTrips }     from '@/lib/hooks/useTrips'
import { COPY }         from '@shared/lib/constants/copy'
import type { TripStatus } from '@shared/lib/types/trip'

const CLOSED_STATUS: TripStatus[] = ['closed', 'cancelled']

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

export default function HistoryPage() {
  const [search, setSearch]       = useState('')
  const [colWidths, setColWidths] = useState<ColWidths>(INITIAL_COL_WIDTHS)
  const resizeRef = useRef<{ id: ColId; startX: number; startW: number } | null>(null)

  const allTrips = useTrips({ status: CLOSED_STATUS })

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
      <TopBar title="Trip History" sub={`${allTrips.length} closed trips`} />

      {/* Search bar */}
      <div className="flex items-center gap-3 px-6 py-3 shrink-0">
        <div className="relative flex-1 max-w-sm">
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
        <SecHead title="Closed Trips" />

        {/* Table scroll area — x+y scroll together */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[700px]">

            {/* Sticky column header — drag right edge handle to resize */}
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
                    icon={<Ic n="clock" s={32} className="text-on-surf-v" />}
                    title="No trip history"
                    body="Closed trips will appear here."
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
                  <ChecklistRow key={trip.id} trip={trip} colWidths={colWidths} />
                ))
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
