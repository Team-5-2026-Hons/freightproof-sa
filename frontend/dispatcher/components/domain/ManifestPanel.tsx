'use client'

import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { Spinner } from '@/components/ui/Spinner'
import { useManifest } from '@/lib/hooks/useManifest'
import { ReconciliationRows } from './ReconciliationRows'
import { fmtFull, fmtTime } from '@shared/lib/utils/datetime'
import type { ConsignmentManifest, Parcel } from '@shared/lib/types/manifest'

// Which scan column this phase cares about. Loading proves parcels left the origin;
// unloading proves they arrived. One component, two emphases.
export type ManifestMode = 'loading' | 'unloading'

interface Props {
  tripId: string
  mode: ManifestMode
  heading: string
  width: number
  onStartResize: (e: React.MouseEvent) => void
  onClose: () => void
  // Unloading only: the counts the phase itself recorded. A mismatch between them is the
  // whole point of the unloading handshake, so it is stated, never inferred.
  parcelCountDestination?: number | null
  driverVisualCount?: number | null
}

export function ManifestPanel({
  tripId, mode, heading, width, onStartResize, onClose,
  parcelCountDestination, driverVisualCount,
}: Props) {
  const { manifest, isLoading, error } = useManifest(tripId)

  return (
    <div
      className="relative bg-surf-low border-l border-outline-v/20 shrink-0 overflow-y-auto"
      style={{ width }}
    >
      {/* Drag handle on the left edge only — Trip Info is fixed-width, so a right-hand
          divider would have no width to trade with. */}
      <div
        onMouseDown={onStartResize}
        className="absolute left-0 top-0 bottom-0 w-[4px] cursor-col-resize hover:bg-sec/30 transition-colors z-10"
      />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
            {heading}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[10px] font-[600] bg-surf-high text-on-surf-v border border-outline-v/30 hover:bg-outline-v/20 transition-colors"
          >
            ✕ Close
          </button>
        </div>

        {/* The manifest endpoint is trip-scoped: Parcel Perfect gives no per-stop split, so
            every occurrence of this panel shows the same parcels. Saying so is cheaper than
            a dispatcher inferring a per-stop breakdown that does not exist. */}
        <div className="text-[10px] text-on-surf-v mb-3 leading-snug">
          Full trip manifest — Parcel Perfect does not break parcels down per stop.
        </div>

        {/* These counts come from the unloading phase itself, not from the manifest fetch —
            so they render regardless of whether Parcel Perfect's manifest has loaded, errored,
            or is still absent. Gating this on `manifest` would hide a real discrepancy behind
            an unrelated fetch failure. */}
        {mode === 'unloading' && (
          <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-2 shadow-level-2">
            <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[5px]">
              Reconciliation
            </div>
            <ReconciliationRows
              countedAtDestination={parcelCountDestination}
              driverVisualCount={driverVisualCount}
            />
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center py-8"><Spinner size="md" /></div>
        )}

        {/* A 404 before loading starts is a state, not a failure. */}
        {!isLoading && (error || !manifest) && (
          <div className="text-[12px] text-on-surf-v bg-surf-lowest rounded-md p-[12px_14px]">
            No manifest pulled from Parcel Perfect yet.
          </div>
        )}

        {!isLoading && manifest && (
          <>
            {manifest.consignments.map(c => (
              <ConsignmentRow key={c.consignment_id} consignment={c} mode={mode} />
            ))}

            <div className="flex items-baseline justify-between gap-3 pt-[10px] mt-[8px] border-t border-outline-v/20">
              <span className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v">Total</span>
              <span className="text-[12px] font-[600] text-on-surf tabular-nums">
                {manifest.total_parcel_count} parcels
              </span>
            </div>
            <div className={`text-[11px] mt-[4px] ${manifest.origin_scan_complete ? 'text-ok' : 'text-on-surf-v'}`}>
              {manifest.origin_scan_complete ? 'Origin scan complete ✓' : 'Origin scan in progress'}
            </div>
            <div className="text-[10px] text-on-surf-v mt-[6px] tabular-nums">
              Pulled {fmtFull(manifest.pulled_at)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ConsignmentRow({ consignment, mode }: { consignment: ConsignmentManifest; mode: ManifestMode }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="bg-surf-lowest rounded-md mb-2 shadow-level-2">
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-[8px] p-[10px_12px] text-left"
      >
        {/* `chev` points right; rotate it for the open state. There is no down variant. */}
        <Ic
          n="chev"
          s={12}
          className={`text-on-surf-v shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span className="font-mono text-[12px] font-[600] tracking-[0.04em] text-on-surf flex-1 truncate">
          {consignment.parcel_perfect_reference}
        </span>
        <span className="text-[11px] text-on-surf-v tabular-nums shrink-0">
          {consignment.unit_count_expected ?? '—'} units · {consignment.total_parcel_count} parcels
        </span>
      </button>

      {isOpen && (
        <div className="px-[12px] pb-[10px]">
          {consignment.stops.map(stop => (
            <div key={stop.delivery_stop} className="mt-[6px]">
              <div className="text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v mb-[3px]">
                {stop.delivery_stop} · {stop.parcel_count}
              </div>
              {stop.parcels.map(p => <ParcelRow key={p.id} parcel={p} mode={mode} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ParcelRow({ parcel, mode }: { parcel: Parcel; mode: ManifestMode }) {
  // Loading is proven by scan-out, unloading by scan-in. Showing the wrong timestamp
  // would make an unscanned parcel look accounted for.
  const scanAt = mode === 'loading' ? parcel.pp_scan_out_at : parcel.pp_scan_in_at
  const isScanned = scanAt !== null

  return (
    <div className="flex items-center gap-[8px] py-[3px] text-[11px]">
      <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${isScanned ? 'bg-ok' : 'bg-outline-v'}`} />
      <span className="font-mono tracking-[0.04em] text-on-surf tabular-nums flex-1 truncate">
        {parcel.barcode}
      </span>
      <span className={`shrink-0 tabular-nums ${isScanned ? 'text-ok' : 'text-on-surf-v'}`}>
        {isScanned ? fmtTime(scanAt) : parcel.status}
      </span>
    </div>
  )
}
