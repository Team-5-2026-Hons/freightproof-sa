'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useManifest } from '@/lib/hooks/useManifest'
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
  const searchId = useId()
  const filterId = useId()

  if (!manifest) {
    if (isLoading) return <div role="status" className="flex items-center justify-center gap-2 py-8"><Spinner size="md" /> Loading manifest…</div>
    return (
      <div className="rounded-md bg-surf-lowest p-3 text-sm text-on-surf-v">
        <p role={error && errorStatus !== 404 ? 'alert' : 'status'}>
          {errorStatus === 404 ? 'No manifest pulled from Parcel Perfect yet.' : error ? `Could not load manifest. ${error}` : 'No manifest available.'}
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

  return (
    <div className="min-w-0 space-y-4 text-on-surf">
      <p className="text-xs leading-relaxed text-on-surf-v">Full trip manifest from Parcel Perfect. These are current scans, separate from counts recorded in phase evidence.</p>
      {error && (
        <div role="alert" className="rounded-md border border-warn/30 bg-warn/10 p-3 text-xs">
          <p>Manifest refresh failed. Showing previously loaded data{lastUpdated ? ` from ${fmtFull(new Date(lastUpdated).toISOString())}` : ''}. {error}</p>
          <Button variant="secondary" size="sm" onClick={refetch} className="mt-2">Retry</Button>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3 rounded-md bg-surf-lowest p-3 text-xs">
        <Total label="Expected consolidated units" value={expectedUnits ?? 'Unknown'} />
        <Total label="Manifest parcels" value={manifest.total_parcel_count} />
        <Total label="Current scanned out" value={scannedOut} />
        <Total label="Current scanned in" value={scannedIn} />
      </dl>
      <p className="text-xs text-on-surf-v">A parcel without a scan-in has no recorded arrival scan yet; this does not establish that it is lost.</p>
      <div className="space-y-3">
        <div>
          <label htmlFor={searchId} className="mb-1 block text-xs font-semibold">Search waybill or barcode</label>
          <input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} className="w-full min-w-0 rounded-md border border-outline-v/30 bg-surf-lowest px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor={filterId} className="mb-1 block text-xs font-semibold">Scan filter</label>
          <select id={filterId} value={filter} onChange={event => setFilter(event.target.value === 'not-scanned-in' ? 'not-scanned-in' : 'all')} className="w-full rounded-md border border-outline-v/30 bg-surf-lowest px-3 py-2 text-sm">
            <option value="all">All parcels</option>
            <option value="not-scanned-in">Not scanned in</option>
          </select>
        </div>
      </div>
      {visible.length === 0 ? <p role="status" className="rounded-md bg-surf-lowest p-3 text-sm">{manifest.consignments.length === 0 ? 'This manifest contains no consignments.' : 'No parcels match this search and scan filter.'}</p> : (
        <div className="space-y-2">
          {visible.map(({ consignment, stops }) => <ConsignmentRow key={consignment.consignment_id} consignment={consignment} stops={stops} />)}
        </div>
      )}
      <div className="border-t border-outline-v/20 pt-3 text-xs text-on-surf-v">
        {/* Origin uses Parcel Perfect's own flag; PP publishes no destination equivalent,
            so that side is derived from the parcels themselves. Reporting only the origin
            left a fully delivered trip still reading as though nothing had arrived. */}
        <p>{manifest.origin_scan_complete ? 'Origin scan complete' : 'Origin scan not complete'}</p>
        <p className="mt-1">
          {parcels.length === 0
            ? 'No parcels to scan in at destination'
            : scannedIn === parcels.length
              ? 'Destination scan complete'
              : `Destination scan not complete · ${scannedIn} of ${parcels.length} scanned in`}
        </p>
        <p className="mt-1">Pulled {fmtFull(manifest.pulled_at)}</p>
        {/* Says when THIS view last reached the server, which "Pulled" does not: that is
            Parcel Perfect's own pull time and can be unchanged by a refresh. */}
        {lastUpdated !== null && <p className="mt-1">Checked {fmtTime(new Date(lastUpdated).toISOString())}</p>}
        <Button variant="ghost" size="sm" onClick={refetch} disabled={isValidating} className="mt-2">
          {isValidating ? 'Refreshing…' : 'Refresh manifest'}
        </Button>
      </div>
    </div>
  )
}

function Total({ label, value }: { label: string; value: number | string }): React.JSX.Element {
  return <div><dt className="text-on-surf-v">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>
}

function ConsignmentRow({ consignment, stops }: { consignment: ConsignmentManifest; stops: ConsignmentManifest['stops'] }): React.JSX.Element {
  return (
    <details className="rounded-md bg-surf-lowest p-3 shadow-level-2">
      <summary className="cursor-pointer text-xs leading-relaxed">
        <span className="break-all font-mono font-semibold">{consignment.parcel_perfect_reference}</span>
        <span className="mt-1 block text-on-surf-v">Expected {consignment.unit_count_expected ?? 'unknown'} units · {consignment.total_parcel_count} manifest parcels</span>
      </summary>
      <div className="mt-3 space-y-3">
        {stops.length === 0 && <p className="text-xs text-on-surf-v">No parcels listed for this waybill.</p>}
        {stops.map(stop => <div key={stop.delivery_stop}>
          <p className="mb-1 text-xs font-semibold text-on-surf-v">{stop.delivery_stop} · {stop.parcels.length} shown</p>
          {stop.parcels.map(parcel => <ParcelRow key={parcel.id} parcel={parcel} />)}
        </div>)}
      </div>
    </details>
  )
}

function ParcelRow({ parcel }: { parcel: Parcel }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-outline-v/10 py-2 text-xs">
    <span className="min-w-0 flex-1 break-all font-mono">{parcel.barcode}</span>
    <span className={parcel.pp_scan_out_at ? 'text-ok' : 'text-on-surf-v'}>Out {parcel.pp_scan_out_at ? fmtTime(parcel.pp_scan_out_at) : 'not recorded'}</span>
    <span className={parcel.pp_scan_in_at ? 'text-ok' : 'text-on-surf-v'}>In {parcel.pp_scan_in_at ? fmtTime(parcel.pp_scan_in_at) : 'not recorded'}</span>
  </div>
}
