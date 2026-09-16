'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { fmtFull } from '@shared/lib/utils/datetime'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'

const OPEN_DELAY_MS = 150
const CLOSE_DELAY_MS = 180

interface TripHeaderSummaryProps {
  trip: Trip
  origin: Precinct | undefined
  destination: Precinct | undefined
  statusLabel: string
  exceptionCount: number
  expectedParcels: number
}

interface OverviewRowProps {
  label: string
  value: string
  mono?: boolean
}

function OverviewRow({ label, value, mono = false }: OverviewRowProps) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-[5px] border-b border-outline-v/15 last:border-0">
      <span className="text-[10px] font-[600] uppercase tracking-[0.08em] text-on-surf-v">
        {label}
      </span>
      <span className={`text-[12px] font-[500] text-on-surf text-right ${mono ? 'font-mono tabular-nums tracking-[0.03em]' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function fullPrecinctLabel(precinct: Precinct | undefined): string {
  if (!precinct) return '—'
  return precinct.address ? `${precinct.name} · ${precinct.address}` : precinct.name
}

function shortPrecinctLabel(precinct: Precinct | undefined): string {
  return precinct?.name.split('—')[0]?.trim() ?? '—'
}

export function TripHeaderSummary({
  trip,
  origin,
  destination,
  statusLabel,
  exceptionCount,
  expectedParcels,
}: TripHeaderSummaryProps) {
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overviewId = `trip-overview-${trip.id}`

  function clearOpenTimer(): void {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }

  function clearCloseTimer(): void {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function openSoon(): void {
    clearCloseTimer()
    if (open) return
    clearOpenTimer()
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
  }

  function openNow(): void {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(true)
  }

  function closeSoon(): void {
    clearOpenTimer()
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }

  function closeNow(): void {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(false)
  }

  useEffect(() => () => {
    clearOpenTimer()
    clearCloseTimer()
  }, [])

  const originShort = shortPrecinctLabel(origin)
  const destinationShort = shortPrecinctLabel(destination)
  const driverName = trip.driver?.full_name ?? 'Unassigned'
  const vehicleRegistration = trip.horse?.registration ?? 'Unassigned'

  return (
    <div
      className="relative min-w-0 max-w-full"
      onMouseEnter={openSoon}
      onMouseLeave={closeSoon}
      onFocusCapture={openNow}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSoon()
      }}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape') return
        closeNow()
      }}
    >
      <button
        type="button"
        aria-label={`Show trip overview for ${trip.trip_reference}`}
        aria-expanded={open}
        aria-controls={overviewId}
        className="group block min-w-0 max-w-full text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec focus-visible:ring-offset-2 focus-visible:ring-offset-surf-lowest"
      >
        <span className="flex items-center gap-[6px] text-[18px] font-[800] tracking-[-0.02em] text-on-surf leading-[20px]">
          <span className="truncate">{trip.trip_reference}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-on-surf-v transition-transform duration-150 ${open ? 'rotate-180' : 'group-hover:text-sec'}`}
          />
        </span>
        <span className="block max-w-full overflow-hidden text-[11px] leading-[13px] font-[500] tracking-[0.02em] text-sec tabular-nums [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {trip.order_number} · {originShort} → {destinationShort} · {driverName} · {vehicleRegistration}
        </span>
      </button>

      {open && (
        <div
          id={overviewId}
          role="region"
          aria-label="Trip overview"
          className="absolute left-0 top-[calc(100%+9px)] z-50 w-[min(460px,calc(100vw-210px))] max-h-[min(620px,calc(100vh-84px))] overflow-y-auto rounded-lg border border-outline-v/30 bg-surf-lowest p-4 shadow-level-4"
        >
          <div className="flex items-start justify-between gap-4 pb-3 mb-2 border-b border-outline-v/20">
            <div>
              <div className="text-[10px] font-[700] uppercase tracking-[0.12em] text-on-surf-v">Trip overview</div>
              <div className="mt-1 text-[15px] font-[750] text-on-surf">{originShort} → {destinationShort}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] font-[700] text-on-surf">{statusLabel}</div>
              <div className="text-[10px] text-on-surf-v">
                {exceptionCount} exception{exceptionCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <OverviewRow label="Order" value={trip.order_number} mono />
          <OverviewRow label="Driver" value={driverName} />
          {trip.driver?.phone_number && <OverviewRow label="Phone" value={trip.driver.phone_number} mono />}
          <OverviewRow label="Horse" value={vehicleRegistration} mono />
          <OverviewRow label="Origin" value={fullPrecinctLabel(origin)} />
          <OverviewRow label="Destination" value={fullPrecinctLabel(destination)} />
          {trip.planned_departure_at && (
            <OverviewRow label="Planned depart" value={fmtFull(trip.planned_departure_at)} />
          )}
          {trip.planned_arrival_at && (
            <OverviewRow label="Planned arrival" value={fmtFull(trip.planned_arrival_at)} />
          )}
          <OverviewRow label="Cargo" value={`${trip.consignments.length} waybill${trip.consignments.length === 1 ? '' : 's'} · ${expectedParcels} parcels booked`} />

          <div className="pt-3 text-[10px] leading-relaxed text-on-surf-v">
            Move away to close · Focus this heading with the keyboard to keep the overview available
          </div>
        </div>
      )}
    </div>
  )
}
