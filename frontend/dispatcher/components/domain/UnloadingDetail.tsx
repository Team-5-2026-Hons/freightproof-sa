'use client'

import { Field, PhaseDetailCard, Section } from './PhaseDetailFields'
import { PhaseLocationSection } from './PhaseLocationSection'
import { PhaseOverrideSection } from './PhaseOverrideSection'
import { locationEvidenceForPhase, hasLocationEvidence } from '@/lib/phase/location-evidence'
import { isClosedPhaseStatus } from '@/lib/types/dev'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

interface Props {
  phase: PhaseDescriptor
  /** Live, summed scanned_in_count over the consignments delivered at THIS stop —
   *  recomputed per request straight from Parcel rows. There is no stamped equivalent
   *  on this phase to fall back to once unloading closes: parcel_count_destination is
   *  written on the CONFIRMATION row instead (see ConfirmationDetail's own comment on
   *  that field), so this stays live for as long as this row is on screen. Null when
   *  nothing on the manifest is booked to arrive here — distinct from a real 0 scanned
   *  so far. */
  scannedInCount: number | null
  /** Manifest baseline for this stop — summed parcel_count_expected over the same
   *  consignments. Same null-is-not-zero rule as scannedInCount. */
  expectedAtStopCount: number | null
  // The precinct this phase is anchored to, resolved by the page from the phase's stop.
  precinct: Precinct | undefined
}

export function UnloadingDetail({
  phase, scannedInCount, expectedAtStopCount, precinct,
}: Props) {
  // Whether unloading itself has been decided — NOT whether the scan count could still
  // change (it always could, since it is recomputed live and nothing stamps it here).
  // This only controls the "scan in progress" note below.
  const resolved = isClosedPhaseStatus(phase.status)

  // Null is not zero: no baseline means nothing to compare, not "nothing was delivered".
  const hasBoth = expectedAtStopCount !== null && scannedInCount !== null
  const missing = hasBoth ? expectedAtStopCount - scannedInCount : 0

  return (
    <PhaseDetailCard>

      {/* Live progress, not the evidence record — parcel_count_destination (the stamped
          figure) is written on the CONFIRMATION row instead, once that later phase
          closes (see ConfirmationDetail's own comment on that field). Nothing on THIS
          row is ever stamped, so this section reads straight off Parcel rows for as
          long as it is on screen and is labelled as live rather than as a record. */}
      <Section title="Warehouse scan">
        <Field label="Scanned off truck (live)" value={scannedInCount?.toString()} />
        <Field label="Expected at this stop" value={expectedAtStopCount?.toString()} />
      </Section>
      {hasBoth && (
        <div className={`text-[11px] font-[600] px-3 pb-3 ${missing === 0 ? 'text-ok' : 'text-warn'}`}>
          {missing === 0 ? 'All parcels scanned ✓' : missing < 0 ? `${Math.abs(missing)} excess scanned` : `${missing} not scanned ✗`}
        </div>
      )}
      {!resolved && (
        <p className="text-[10px] text-on-surf-v px-3 pb-3">
          Scan in progress — this count may still change.
        </p>
      )}

      {/* hasLocationEvidence guards the section so a row with neither a fix nor a stored
          verdict does not grow an empty "Location at unloading" heading. This is NOT
          because the backend fails to capture a fix here: UnloadingCompleteRequest
          extends _PhaseCompleteBase, advance_unloading records the driver's position and
          runs corroboration against it, and the driver app sends its position for
          unloading. A null phone fix is a legitimate outcome of that capture (indoor,
          permission denied, offline), not evidence the contract omits the field; the gate
          keys off what was actually recorded, not off what the contract allows. */}
      {hasLocationEvidence(locationEvidenceForPhase(phase, precinct)) && (
        <PhaseLocationSection phase={phase} precinct={precinct} title="Location at unloading" />
      )}

      <PhaseOverrideSection phase={phase} />

    </PhaseDetailCard>
  )
}
