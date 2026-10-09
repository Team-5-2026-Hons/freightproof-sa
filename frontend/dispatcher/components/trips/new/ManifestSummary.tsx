'use client'

import { Chip } from '@/components/ui/Chip'
import { ManifestStat, WaybillLinesTable } from '@/components/domain/PPManifestParts'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'

export interface ManifestSummaryProps {
  preview: PPManifestPreview
}

/** What the client's manifest says (spec §11 step 1). Times are not repeated:
 *  the route & schedule card shows them as the values the trip will lock. */
export function ManifestSummary({ preview }: ManifestSummaryProps): React.JSX.Element {
  const { pp_manifest: ref, totals } = preview

  return (
    <section aria-label={`Manifest ${ref.display}`} className="flex flex-col gap-4">
      {/* The manifest is the title and the client the line under it, so neither is repeated
          below. The card's own heading already says "Client manifest". */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[20px] font-[800] leading-tight tabular-nums text-on-surf">
            {ref.origin_hub} {ref.number}
          </p>
          <p className="mt-1 text-[13px] text-on-surf-v">
            <span className="font-[600] text-on-surf">{preview.client_name}</span>
            {preview.client_reference && (
              <> · Ref <span className="tabular-nums">{preview.client_reference}</span></>
            )}
          </p>
        </div>
        <Chip type={preview.is_closed ? 'complete' : 'pending'} label={preview.is_closed ? 'Closed' : 'Open'} />
      </div>

      {/* Short values in their own tiles: one long "3 waybills · 20 parcels · 875.5 kg" string
          wrapped across lines in a quarter-width column. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ManifestStat label="Route" value={`${preview.origin.hub_code} → ${preview.destination.hub_code}`} />
        <ManifestStat label="Waybills" value={String(totals.waybills)} />
        <ManifestStat label="Parcels" value={String(totals.parcels)} />
        <ManifestStat label="Weight" value={`${totals.weight_kg} kg`} />
      </dl>

      {preview.waybills.length > 0 && (
        <details className="rounded-lg border border-outline-v/20 bg-surf-low">
          <summary className="cursor-pointer px-4 py-3 text-[12px] font-[700] text-on-surf">
            Waybills ({preview.waybills.length})
          </summary>
          <div className="px-4 pb-3">
            <WaybillLinesTable lines={preview.waybills} caption={`Waybills on manifest ${ref.display}`} />
          </div>
        </details>
      )}

      {preview.notes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-[700] uppercase tracking-[0.1em] text-on-surf-v">Manifest notes</p>
          <ul className="flex flex-col gap-2">
            {preview.notes.map((note, index) => (
              <li key={`${note.noted_at}-${index}`} className="text-[12px] leading-relaxed text-on-surf">
                <span className="tabular-nums text-on-surf-v">{fmtDateTime(note.noted_at)} · {note.operator}</span>
                <span className="block">{note.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </section>
  )
}
