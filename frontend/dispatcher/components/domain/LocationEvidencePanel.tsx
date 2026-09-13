'use client'

// Read-only recorded-location comparison: the driver phone fix and the horse tracker fix
// for one phase, the stored geofence verdict, and (behind a single "View on map" button)
// the interactive map that draws them. Opening the modal never mutates anything: no
// review call, no API call, nothing beyond local component state.

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

// Shown only when the boundary is too far from every recorded fix to appear in the
// map's default frame (see boundaryIsNearby/BOUNDARY_NEARBY_METRES in
// lib/phase/location-evidence.ts): a plain reference distance, explicitly labelled as such,
// never a geofence verdict.

// The single entry point into the map modal: exported so every test (and any future
// consumer) refers to one string, not a copy-pasted literal that can drift from it.
export const VIEW_ON_MAP_LABEL = 'View on map'

// Modal-body map height: taller on md+ (where the map sits beside the InfoRow column
// rather than above it, so it can afford more of the modal's vertical space) and
// shorter below md (where it stacks above six-plus rows and a button, and still has to
// fit a normal laptop viewport without the modal needing its own scrollbar).
const MAP_MODAL_HEIGHT_CLASS = 'h-[360px] md:h-[460px] w-full'

// Two-column layout for the xl modal: a flexible left column for the map, a fixed-width
// right column for the InfoRows and Close button. Below `md` this class contributes no
// `grid-template-columns` at all, so the grid falls back to a single implicit column and
// its two children (the map, then the rows/Close column) stack in source order, the
// same "map, rows, Close" order this modal always rendered.
// 440px, not 300: the InfoRow values are right-aligned prose (a boundary name plus radius,
// a distance sentence) and at 300px they wrapped to three lines, which read slowly. 440px keeps every
// fact row to one line at the modal's xl width.
const MODAL_GRID_COLUMNS_CLASS = 'grid gap-4 md:grid-cols-[minmax(0,1fr)_440px]'

// Legend marker glyphs, matched to the shapes LocationComparisonMap actually draws for
// each layer. Kept here rather than in the map component, since the legend is
// presentation for THIS modal (it sits beside the map, not inside it).
const DRIVER_MARKER_SYMBOL = '●' // ●
const TRACKER_MARKER_SYMBOL = '■' // ■
const BOUNDARY_MARKER_SYMBOL = '◌' // ◌
const INLINE_SEPARATOR = ' · ' // one separator style reused by every modal row that joins parts

// Modal-only short forms. The full BOUNDARY_REFERENCE_LABEL already sits in the legend row,
// so the Boundary and Distance rows can say "(reference only)" once, in their label, and
// keep their values to one line. The panel's own full-width Field keeps the long form.
const MODAL_LEGEND_BOUNDARY_LABEL = 'Precinct boundary (reference only)'
const MODAL_BOUNDARY_ROW_LABEL = 'Boundary (reference only)'
const MODAL_DISTANCE_ROW_LABEL = 'Distance to precinct centre (reference only)'
const MODAL_DISTANCE_SUFFIX = 'from nearest fix'

/** `lat.toFixed(6), lng.toFixed(6)`: the one place this component reads raw coords. */
function coordsValue(fix: RecordedFix): string {
  return `${fix.coords.lat.toFixed(6)}, ${fix.coords.lng.toFixed(6)}`
}

/** Capture time when known, else the fix's own note, else the plain "not recorded" line:
 *  constraint 2's ordering exactly. Never `completed_at`: that dates the phase, not the fix. */
function captureValue(fix: RecordedFix): string {
  if (fix.capturedAt) return fmtDateTime(fix.capturedAt)
  if (fix.captureNote) return fix.captureNote
  return CAPTURE_TIME_NOT_RECORDED
}

/** Legend line under the map. The boundary marker is included only when a boundary was
 *  actually drawn, so the legend never promises a layer the map didn't render. */
function legendText(hasBoundary: boolean): string {
  const parts = [
    `${DRIVER_MARKER_SYMBOL} ${FIX_LABELS.driver_phone}`,
    `${TRACKER_MARKER_SYMBOL} ${FIX_LABELS.horse_tracker}`,
  ]
  if (hasBoundary) parts.push(`${BOUNDARY_MARKER_SYMBOL} ${MODAL_LEGEND_BOUNDARY_LABEL}`)
  return parts.join(INLINE_SEPARATOR)
}

/** The Boundary field/row text, shared by the panel and the modal so both surfaces state
 *  the same fact the same way. */
function boundaryValue(boundary: LocationEvidence['boundary']): string {
  return boundary
    ? `${BOUNDARY_REFERENCE_LABEL}: ${boundary.precinctName}, ${Math.round(boundary.radiusMetres)} m radius`
    : NO_BOUNDARY_RECORDED
}

/** The Distance to precinct centre row's value: explicitly "from the nearest recorded
 *  fix" (matching what boundaryDistanceMetres actually measures) and explicitly
 *  "reference only", so this never reads as a geofence verdict. */
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
  // Computed once and reused by both the panel's own Field and the modal's InfoRow,
  // so the two surfaces can never show a different reading of the same evidence.
  const separationText = separationMetres === null ? COMPARISON_UNAVAILABLE : formatSeparation(separationMetres)
  // Null whenever there is no boundary or no fix to measure from (see
  // boundaryDistanceMetres); the row below only renders once this is known AND the
  // boundary is far enough that the map's default frame would otherwise hide it.
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
          {/* Modal (and therefore this map) never mounts until modalOpen flips true:
              Modal returns null while closed, so LocationComparisonMap's Leaflet-loading
              effect never runs for a card the user hasn't opened. */}
          <LocationComparisonMap evidence={evidence} className={MAP_MODAL_HEIGHT_CLASS} />
          {/* `flex flex-col` plus `mt-auto` on the Close button below lets Close sit at
              the bottom of this column on desktop, where the grid stretches this column
              to the map's own height by default; below `md` (see MODAL_GRID_COLUMNS_CLASS)
              this column's height is just its own content, so `mt-auto` collapses to no
              extra space and Close simply follows the rows in source order. */}
          <div className="flex flex-col">
            {/* The map is never the only carrier of the fact: the same reading shown
                above as Fields is repeated here as InfoRows, in the house
                trip-detail-modal pattern (see PrecinctModal.tsx / VehicleModal.tsx). */}
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
