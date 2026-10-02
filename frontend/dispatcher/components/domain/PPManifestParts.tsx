// The pieces both PP manifest views are built from: the create screen's preview
// (trips/new ManifestSummary) and the trip panel's manifest at creation (ManifestSnapshot).
// The backend sends both views the same waybill-line and totals shapes, so one rendering
// keeps the two describing a manifest identically.

import type { PPManifestWaybillLine } from '@shared/lib/types/pp-manifest'
import { cn } from '@shared/lib/utils/cn'

export function ManifestFact(
  { label, value, numeric = false }: { label: string; value: string; numeric?: boolean },
): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">{label}</dt>
      <dd className={cn('mt-1 break-words text-[13px] font-[600] text-on-surf', numeric && 'tabular-nums tracking-[0.03em]')}>
        {value}
      </dd>
    </div>
  )
}

/** One short figure with its label: read at a glance, never wrapped. White with an outline,
 *  not a grey fill, so it stands out on both the white dialog and the grey side panel. */
export function ManifestStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-outline-v/25 bg-surf-lowest px-3 py-2">
      <dt className="whitespace-nowrap text-[11px] font-[600] text-on-surf-v">{label}</dt>
      <dd className="mt-[2px] whitespace-nowrap text-[15px] font-[700] tabular-nums text-on-surf">{value}</dd>
    </div>
  )
}

export function WaybillLinesTable(
  { lines, caption }: { lines: readonly PPManifestWaybillLine[]; caption: string },
): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px] text-on-surf">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-[10px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">
            <th scope="col" className="py-2 pr-3">Waybill</th>
            <th scope="col" className="py-2 pr-3">Destination</th>
            <th scope="col" className="py-2 pr-3 text-right">Parcels</th>
            <th scope="col" className="py-2 text-right">Weight</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line.waybill} className="border-t border-outline-v/10">
              <td className="py-2 pr-3 font-[600] tabular-nums tracking-[0.03em]">{line.waybill}</td>
              <td className="py-2 pr-3">{line.destination_town}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{line.parcel_count}</td>
              <td className="py-2 text-right tabular-nums">
                {line.weight_kg !== null ? `${line.weight_kg} kg` : 'Not stated'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
