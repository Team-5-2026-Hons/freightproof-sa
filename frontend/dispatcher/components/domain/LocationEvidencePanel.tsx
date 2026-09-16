'use client'

// Read-only recorded-location comparison: driver phone fix, horse tracker fix, stored
// geofence verdict, and (behind "View on map") the interactive map that draws them.

import { useState } from 'react'
import { LocationComparisonMap } from '@/components/map/LocationComparisonMap'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { InfoRow } from '@/components/ui/InfoRow'
import { Field } from './PhaseDetailFields'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { formatSeparation } from '@/lib/phase/geo'
import {
  BOUNDARY_REFERENCE_LABEL,
  COMPARISON_UNAVAILABLE,
  FIX_LABELS,
  VERDICT_LABELS,
  boundaryDistanceMetres,
  boundaryIsNearby,
  hasAnyFix,
  type LocationEvidence,
  type RecordedFix,
} from '@/lib/phase/location-evidence'

interface Props {
  evidence: LocationEvidence
  /** Names the record the comparison belongs to, e.g. "Activation at Cape Town DC". Used in the modal title. */
  contextLabel: string
}

const NO_FIX_RECORDED = 'No fix recorded'
const CAPTURE_TIME_NOT_RECORDED = 'Capture time not recorded'
const NO_BOUNDARY_RECORDED = 'No boundary recorded for this phase'

// Exported so every test (and any future consumer) refers to one string, not a copy-pasted literal.
export const VIEW_ON_MAP_LABEL = 'View on map'

// Taller on md+, where the map sits beside the InfoRow column instead of above it.
const MAP_MODAL_HEIGHT_CLASS = 'h-[360px] md:h-[460px] w-full'

// Two-column layout for the xl modal: flexible map column, fixed-width InfoRow/Close
// column. Below `md` this contributes no grid-template-columns, so children stack in
// source order. 440px keeps every fact row to one line (300px wrapped to three).
const MODAL_GRID_COLUMNS_CLASS = 'grid gap-4 md:grid-cols-[minmax(0,1fr)_440px]'

// Legend marker glyphs, matched to the shapes LocationComparisonMap draws for each layer.
const DRIVER_MARKER_SYMBOL = '●' // ●
const TRACKER_MARKER_SYMBOL = '■' // ■
const BOUNDARY_MARKER_SYMBOL = '◌' // ◌
const INLINE_SEPARATOR = ' · ' // one separator style reused by every modal row that joins parts

// Modal-only short forms: the "(reference only)" caveat lives in the label so values stay one line.
const MODAL_LEGEND_BOUNDARY_LABEL = 'Precinct boundary (reference only)'
const MODAL_BOUNDARY_ROW_LABEL = 'Boundary (reference only)'
const MODAL_DISTANCE_ROW_LABEL = 'Distance to precinct centre (reference only)'
const MODAL_DISTANCE_SUFFIX = 'from nearest fix'

/** `lat.toFixed(6), lng.toFixed(6)`. */
function coordsValue(fix: RecordedFix): string {
  return `${fix.coords.lat.toFixed(6)}, ${fix.coords.lng.toFixed(6)}`
}

/** Capture time when known, else the fix's own note, else "not recorded". Never
 *  `completed_at`: that dates the phase, not the fix. */
function captureValue(fix: RecordedFix): string {
  if (fix.capturedAt) return fmtDateTime(fix.capturedAt)
  if (fix.captureNote) return fix.captureNote
  return CAPTURE_TIME_NOT_RECORDED
}

/** Legend line under the map; boundary marker included only when a boundary was drawn. */
function legendText(hasBoundary: boolean): string {
  const parts = [
    `${DRIVER_MARKER_SYMBOL} ${FIX_LABELS.driver_phone}`,
    `${TRACKER_MARKER_SYMBOL} ${FIX_LABELS.horse_tracker}`,
  ]
  if (hasBoundary) parts.push(`${BOUNDARY_MARKER_SYMBOL} ${MODAL_LEGEND_BOUNDARY_LABEL}`)
  return parts.join(INLINE_SEPARATOR)
}

/** The Boundary field/row text, shared by the panel and the modal. */
function boundaryValue(boundary: LocationEvidence['boundary']): string {
  return boundary
    ? `${BOUNDARY_REFERENCE_LABEL}: ${boundary.precinctName}, ${Math.round(boundary.radiusMetres)} m radius`
    : NO_BOUNDARY_RECORDED
}

/** Distance from the nearest recorded fix — reference only, never a geofence verdict. */
function distanceToPrecinctValue(distanceMetres: number): string {
  return `${formatSeparation(distanceMetres)} ${MODAL_DISTANCE_SUFFIX}`
}

/** Modal Boundary row: precinct and radius only, the "reference only" caveat lives in the label. */
function modalBoundaryValue(boundary: NonNullable<LocationEvidence['boundary']>): string {
  return `${boundary.precinctName}, ${Math.round(boundary.radiusMetres)} m radius`
}

export function LocationEvidencePanel({ evidence, contextLabel }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const closeModal = () => setModalOpen(false)
  const { driverFix, trackerFix, separationMetres, verdict, boundary } = evidence
  // Computed once and reused by both the panel Field and the modal InfoRow.
  const separationText = separationMetres === null ? COMPARISON_UNAVAILABLE : formatSeparation(separationMetres)
  // Null when there's no boundary or no fix to measure from; the row below only renders
  // when known and the boundary is far enough that the map's default frame would hide it.
  const boundaryDistance = boundaryDistanceMetres(evidence)
  const showBoundaryDistance = boundaryDistance !== null && !boundaryIsNearby(evidence)

  return (
    <>
      <Field label={FIX_LABELS.driver_phone} value={driverFix ? coordsValue(driverFix) : NO_FIX_RECORDED} mono />
      <Field label={FIX_LABELS.horse_tracker} value={trackerFix ? coordsValue(trackerFix) : NO_FIX_RECORDED} mono />
      {driverFix && <Field label={`${FIX_LABELS.driver_phone} capture time`} value={captureValue(driverFix)} />}
      {trackerFix && <Field label={`${FIX_LABELS.horse_tracker} capture time`} value={captureValue(trackerFix)} />}

      <Field label="Driver / vehicle separation" value={separationText} />
      <Field label="Geofence verdict" value={VERDICT_LABELS[verdict]} />

      <Field label="Boundary" value={boundaryValue(boundary)} span />

      {hasAnyFix(evidence) && (
        <div className="col-span-2 mt-1">
          <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
            {VIEW_ON_MAP_LABEL}
          </Button>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={`Recorded locations: ${contextLabel}`}
        size="xl"
      >
        <div className={MODAL_GRID_COLUMNS_CLASS}>
          {/* Never mounts until modalOpen flips true: Modal returns null while closed,
              so LocationComparisonMap's Leaflet-loading effect never runs unopened. */}
          <LocationComparisonMap evidence={evidence} className={MAP_MODAL_HEIGHT_CLASS} />
          {/* `mt-auto` lets Close sit at the bottom of this column on desktop, where the
              grid stretches it to the map's height; below `md` it collapses to no-op. */}
          <div className="flex flex-col">
            {/* Repeats the Fields above as InfoRows — house trip-detail-modal pattern
                (see PrecinctModal.tsx / VehicleModal.tsx). */}
            <InfoRow label="Legend" value={legendText(boundary !== null)} />
            <InfoRow label={FIX_LABELS.driver_phone} value={driverFix ? coordsValue(driverFix) : NO_FIX_RECORDED} mono />
            <InfoRow label={FIX_LABELS.horse_tracker} value={trackerFix ? coordsValue(trackerFix) : NO_FIX_RECORDED} mono />
            <InfoRow label="Driver / vehicle separation" value={separationText} />
            <InfoRow label="Geofence verdict" value={VERDICT_LABELS[verdict]} />
            {boundary && <InfoRow label={MODAL_BOUNDARY_ROW_LABEL} value={modalBoundaryValue(boundary)} />}
            {showBoundaryDistance && boundaryDistance !== null && (
              <InfoRow label={MODAL_DISTANCE_ROW_LABEL} value={distanceToPrecinctValue(boundaryDistance)} />
            )}
            <div className="mt-auto pt-4">
              <Button variant="secondary" full onClick={closeModal}>Close</Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}
