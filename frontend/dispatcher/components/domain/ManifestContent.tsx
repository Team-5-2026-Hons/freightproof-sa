'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { Spinner } from '@/components/ui/Spinner'
import { useManifest } from '@/lib/hooks/useManifest'
import { ManifestSnapshot } from './ManifestSnapshot'
import { ManifestStat } from './PPManifestParts'
import { fmtFull, fmtTime } from '@shared/lib/utils/datetime'
import type { ConsignmentManifest, Parcel } from '@shared/lib/types/manifest'

export interface ManifestContentProps {
  tripId: string
}

type ScanFilter = 'all' | 'not-scanned-in'

/** Trip-scoped evidence content; the caller owns its panel or dialog shell. */
export function ManifestContent({ tripId }: ManifestContentProps): React.JSX.Element {
  const { manifest, isLoading, isValidating, error, errorStatus, lastUpdated, refetch } = useManifest(tripId)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ScanFilter>('all')
  const recordHeadingId = useId()

  if (!manifest) {
    if (isLoading) return <div role="status" className="flex items-center justify-center gap-2 py-8"><Spinner size="md" /> Loading manifest…</div>
    return (
      <div className="rounded-md bg-surf-lowest p-3 text-sm text-on-surf-v">
        <p role={error && errorStatus !== 404 ? 'alert' : 'status'}>
          {errorStatus === 404 ? 'No manifest pulled yet.' : error ? `Could not load manifest. ${error}` : 'No manifest available.'}
        </p>
        <Button variant="secondary" size="sm" onClick={refetch} className="mt-3">Retry</Button>
      </div>
    )
  }

  const parcels = manifest.consignments.flatMap(consignment => consignment.stops.flatMap(stop => stop.parcels))
  const scannedOut = parcels.filter(parcel => parcel.pp_scan_out_at !== null).length
  const scannedIn = parcels.filter(parcel => parcel.pp_scan_in_at !== null).length
  // Consolidated units and individual parcels have different grains and cannot reconcile.
  const expectedUnits = manifest.consignments.some(consignment => consignment.unit_count_expected === null)
    ? null
    : manifest.consignments.reduce((sum, consignment) => sum + (consignment.unit_count_expected ?? 0), 0)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = manifest.consignments.map(consignment => {
    const matchesWaybill = consignment.parcel_perfect_reference.toLocaleLowerCase().includes(normalizedQuery)
    const stops = consignment.stops.map(stop => ({
      ...stop,
      parcels: stop.parcels.filter(parcel =>
        (matchesWaybill || parcel.barcode.toLocaleLowerCase().includes(normalizedQuery))
        && (filter === 'all' || parcel.pp_scan_in_at === null)),
    })).filter(stop => stop.parcels.length > 0)
    return { consignment, stops, visible: stops.length > 0 || (filter === 'all' && matchesWaybill) }
  }).filter(row => row.visible)

  // A cancelled trip whose waybills moved to the trip that replaced it (spec §10.5) has no
  // consignment rows left. The H0 snapshot is then its only cargo record, and "no
  // consignments" would be a false statement about the trip. The refresh error and refresh
  // control below still apply, so this is a branch of the one layout, not an early return.
  const snapshotOnly = manifest.consignments.length === 0 && manifest.pp_manifest_snapshot !== null

  return (
    <div className="min-w-0 space-y-4 text-on-surf">
      {error && (
        <div role="alert" className="rounded-md border border-warn/30 bg-warn/10 p-3 text-xs">
          <p>Manifest refresh failed. Showing previously loaded data{lastUpdated ? ` from ${fmtFull(new Date(lastUpdated).toISOString())}` : ''}. {error}</p>
          <Button variant="secondary" size="sm" onClick={refetch} className="mt-2">Retry</Button>
        </div>
      )}
      {snapshotOnly && manifest.pp_manifest_snapshot ? (
        <ManifestSnapshot snapshot={manifest.pp_manifest_snapshot} variant="only-record" />
      ) : (
        <>
          {/* Current scans, read from the parcels. Both sides as "n / total", so a fully
              delivered trip never reads as though nothing had arrived. */}
          {/* Always 2 × 2: this panel is narrow whether it opens as a dialog or docks beside
              the timeline, and four columns there broke "Scanned out" over two lines. */}
          <dl className="grid grid-cols-2 gap-2">
            <ManifestStat label="Waybills" value={String(manifest.consignments.length)} />
            <ManifestStat label="Parcels" value={String(manifest.total_parcel_count)} />
            <ManifestStat label="Scanned out" value={`${scannedOut} / ${parcels.length}`} />
            <ManifestStat label="Scanned in" value={`${scannedIn} / ${parcels.length}`} />
            {/* Units are dispatcher-entered pallet counts; manifest trips have none (FP-281 §14). */}
            {expectedUnits !== null && <ManifestStat label="Units" value={String(expectedUnits)} />}
          </dl>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              aria-label="Search waybill or barcode"
              placeholder="Search waybill or barcode"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-outline-v/30 bg-surf-lowest px-3 py-2 text-sm"
            />
            <select
              aria-label="Scan filter"
              value={filter}
              onChange={event => setFilter(event.target.value === 'not-scanned-in' ? 'not-scanned-in' : 'all')}
              className="rounded-md border border-outline-v/30 bg-surf-lowest px-3 py-2 text-sm"
            >
              <option value="all">All parcels</option>
              <option value="not-scanned-in">Not scanned in</option>
            </select>
          </div>

          {visible.length === 0 ? <p role="status" className="rounded-md bg-surf-lowest p-3 text-sm">{manifest.consignments.length === 0 ? 'No waybills on this trip.' : 'No parcels match this search and scan filter.'}</p> : (
            <div className="space-y-2">
              {visible.map(({ consignment, stops }) => <ConsignmentRow key={consignment.consignment_id} consignment={consignment} stops={stops} />)}
            </div>
          )}

          {/* The locked record is not another waybill: its own heading, apart from the live list. */}
          {manifest.pp_manifest_snapshot && (
            <section aria-labelledby={recordHeadingId} className="border-t border-outline-v/20 pt-3">
              <h3 id={recordHeadingId} className="mb-2 text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">
                Locked at creation
              </h3>
              <ManifestSnapshot snapshot={manifest.pp_manifest_snapshot} variant="reference" />
            </section>
          )}
        </>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-outline-v/20 pt-3 text-xs text-on-surf-v">
        {/* "Pulled" is the parcel system's own pull time and can be unchanged by a refresh;
            "checked" says when this view last reached the server. */}
        <p className="tabular-nums">
          Pulled {fmtFull(manifest.pulled_at)}
          {lastUpdated !== null && ` · checked ${fmtTime(new Date(lastUpdated).toISOString())}`}
        </p>
        <Button variant="ghost" size="sm" onClick={refetch} disabled={isValidating}>
          {isValidating ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
    </div>
  )
}

function ConsignmentRow({ consignment, stops }: { consignment: ConsignmentManifest; stops: ConsignmentManifest['stops'] }): React.JSX.Element {
  // Progress over the whole waybill, not the filtered stops shown when expanded.
  const all = consignment.stops.flatMap(stop => stop.parcels)
  const out = all.filter(parcel => parcel.pp_scan_out_at !== null).length
  const scannedIn = all.filter(parcel => parcel.pp_scan_in_at !== null).length
  return (
    <details className="group rounded-md bg-surf-lowest p-3 shadow-level-2">
      {/* A flex summary drops the browser's disclosure marker, so the chevron is drawn. */}
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <Ic n="chev" s={10} className="shrink-0 text-on-surf-v transition-transform duration-150 group-open:rotate-90" />
          <span className="break-all font-mono font-semibold">{consignment.parcel_perfect_reference}</span>
        </span>
        <span className="tabular-nums text-on-surf-v">
          {consignment.unit_count_expected !== null && `${consignment.unit_count_expected} units · `}
          {consignment.total_parcel_count} parcels · {out} out · {scannedIn} in
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {stops.length === 0 && <p className="text-xs text-on-surf-v">No parcels listed for this waybill.</p>}
        {/* Stop headings only when a waybill splits across stops: manifest parcels carry no
            delivery stop, and a lone "Unassigned" heading read like a fault. */}
        {stops.map(stop => <div key={stop.delivery_stop}>
          {consignment.stops.length > 1 && (
            <p className="mb-1 text-xs font-semibold text-on-surf-v">{stop.delivery_stop} · {stop.parcels.length} shown</p>
          )}
          {stop.parcels.map(parcel => <ParcelRow key={parcel.id} parcel={parcel} />)}
        </div>)}
      </div>
    </details>
  )
}

function ParcelRow({ parcel }: { parcel: Parcel }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-outline-v/10 py-2 text-xs">
    <span className="min-w-0 flex-1 break-all font-mono">{parcel.barcode}</span>
    {/* "—" for no scan yet: "not recorded" twice on every parcel buried the ones that were. */}
    <span className={parcel.pp_scan_out_at ? 'tabular-nums text-ok' : 'text-on-surf-v'}>Out {parcel.pp_scan_out_at ? fmtTime(parcel.pp_scan_out_at) : '—'}</span>
    <span className={parcel.pp_scan_in_at ? 'tabular-nums text-ok' : 'text-on-surf-v'}>In {parcel.pp_scan_in_at ? fmtTime(parcel.pp_scan_in_at) : '—'}</span>
  </div>
}
