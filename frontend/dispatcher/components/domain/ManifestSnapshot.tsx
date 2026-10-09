'use client'

import { ManifestFact, WaybillLinesTable } from './PPManifestParts'
import { fmtManifestCargo } from '@/lib/format/manifest'
import type { PPManifestSnapshot } from '@shared/lib/types/pp-manifest'

export interface ManifestSnapshotProps {
  snapshot: PPManifestSnapshot
  /** only-record: a cancelled trip whose waybills moved, so this is all there is.
   *  reference: collapsed beside the live list, for comparison. */
  variant: 'only-record' | 'reference'
}

/** The PP manifest as locked into the journey hash at creation (H0, spec §7.3). Later
 *  Parcel Perfect changes never alter it (§10.6). */
export function ManifestSnapshot({ snapshot, variant }: ManifestSnapshotProps): React.JSX.Element {
  const body = (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3">
        <ManifestFact
          label="Manifest"
          value={`${snapshot.origin_hub} ${snapshot.manifest_number} · ${snapshot.issuer_name}`}
          numeric
        />
        <ManifestFact label="Route" value={`${snapshot.origin_hub} → ${snapshot.destination_hub}`} numeric />
        <ManifestFact
          label="Client reference"
          value={snapshot.client_reference ?? 'None on the manifest'}
          numeric={snapshot.client_reference !== null}
        />
        <ManifestFact label="At creation" value={fmtManifestCargo(snapshot.totals)} numeric />
      </dl>
      <WaybillLinesTable lines={snapshot.waybills} caption="Waybills at creation" />
    </div>
  )

  if (variant === 'only-record') {
    return (
      <section aria-label="Manifest at creation" className="min-w-0 space-y-3 rounded-md bg-surf-lowest p-3 text-on-surf">
        <h3 className="text-xs font-bold uppercase tracking-wide text-on-surf-v">Manifest at creation</h3>
        <p className="text-xs leading-relaxed text-on-surf-v">
          No waybills are on this trip any more: after it was cancelled they moved to the trip that replaced
          it. This is the client&apos;s manifest as it was locked into the journey hash at creation.
        </p>
        {body}
      </section>
    )
  }

  return (
    <details className="rounded-md bg-surf-lowest p-3 text-on-surf shadow-level-2">
      <summary className="cursor-pointer text-xs font-semibold">
        {snapshot.origin_hub} {snapshot.manifest_number} · {fmtManifestCargo(snapshot.totals, { withWeight: false })}
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-on-surf-v">
        The client&apos;s manifest as locked into the journey hash. Later changes to it show in the
        list above, not here.
      </p>
      <div className="mt-3">{body}</div>
    </details>
  )
}
