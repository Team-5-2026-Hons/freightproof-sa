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
  PROXIMITY_LABELS,
  VERDICT_LABELS,
  boundaryDistanceMetres,
  boundaryIsNearby,
  hasAnyFix,
  type LocationEvidence,
  type RecordedFix,
} from '@/lib/phase/location-evidence'

interface Props {
  evidence: LocationEvidence
  contextLabel: string
  hideMapButton?: boolean
  showCoordinates?: boolean
}

const NO_FIX_RECORDED = 'No fix recorded'
const CAPTURE_TIME_NOT_RECORDED = 'Capture time not recorded'
const TRACKER_TIME_NOT_RECORDED = 'Tracker reading time not recorded.'
const NO_BOUNDARY_RECORDED = 'No boundary recorded for this phase'
const RECORDED_BOUNDARY_UNAVAILABLE = 'Recorded boundary unavailable'

export const VIEW_ON_MAP_LABEL = 'View on map'

const MAP_MODAL_HEIGHT_CLASS = 'h-[360px] md:h-[460px] w-full'

const MODAL_GRID_COLUMNS_CLASS = 'grid gap-4 md:grid-cols-[minmax(0,1fr)_440px]'

const DRIVER_MARKER_SYMBOL = '●'
const TRACKER_MARKER_SYMBOL = '■'
const BOUNDARY_MARKER_SYMBOL = '◌'
const INLINE_SEPARATOR = ' · '

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
  if (fix.source === 'horse_tracker') return TRACKER_TIME_NOT_RECORDED
  if (fix.captureNote) return fix.captureNote
  return CAPTURE_TIME_NOT_RECORDED
}

/** Legend line under the map. The boundary marker is included only when a boundary was
 *  actually drawn, so the legend never promises a layer the map didn't render. */
function legendText(boundary: LocationEvidence['boundary']): string {
  const parts = [
    `${DRIVER_MARKER_SYMBOL} ${FIX_LABELS.driver_phone}`,
    `${TRACKER_MARKER_SYMBOL} ${FIX_LABELS.horse_tracker}`,
  ]
  if (boundary) parts.push(`${BOUNDARY_MARKER_SYMBOL} ${boundary.provenance === 'recorded_snapshot' ? 'Recorded precinct boundary' : MODAL_LEGEND_BOUNDARY_LABEL}`)
  return parts.join(INLINE_SEPARATOR)
}

/** "200 m radius" or "property outline (6 corners)" — the fence named the way it was judged. */
function fenceText(boundary: NonNullable<LocationEvidence['boundary']>): string {
  return boundary.polygon
    ? `property outline (${boundary.polygon.length} corners)`
    : `${Math.round(boundary.radiusMetres)} m radius`
}

/** The Boundary field/row text, shared by the panel and the modal so both surfaces state
 *  the same fact the same way. */
function boundaryValue(boundary: LocationEvidence['boundary'], assessmentRecorded: boolean | undefined): string {
  return boundary
    ? boundary.provenance === 'recorded_snapshot'
      ? `Recorded boundary and policy${boundary.policyVersion ? ` (${boundary.policyVersion})` : ''}: ${boundary.precinctName}, ${fenceText(boundary)}${boundary.toleranceMetres !== undefined ? `, ${Math.round(boundary.toleranceMetres)} m tolerance` : ''}`
      : `${BOUNDARY_REFERENCE_LABEL}: ${boundary.precinctName}, ${fenceText(boundary)}`
    : assessmentRecorded ? RECORDED_BOUNDARY_UNAVAILABLE : NO_BOUNDARY_RECORDED
}

/** The Distance to precinct centre row's value: explicitly "from the nearest recorded
 *  fix" (matching what boundaryDistanceMetres actually measures) and explicitly
 *  "reference only", so this never reads as a geofence verdict. */
function distanceToPrecinctValue(distanceMetres: number): string {
  return `${formatSeparation(distanceMetres)} ${MODAL_DISTANCE_SUFFIX}`
}

/** Modal Boundary row: precinct and fence only, the "reference only" caveat lives in the label. */
function modalBoundaryValue(boundary: NonNullable<LocationEvidence['boundary']>): string {
  const policy = boundary.provenance === 'recorded_snapshot' && boundary.policyVersion
    ? ` · policy ${boundary.policyVersion}`
    : ''
  return `${boundary.precinctName}, ${fenceText(boundary)}${policy}`
}

interface ModalProps {
  open: boolean
  onClose: () => void
  evidence: LocationEvidence
  contextLabel: string
}

/** The map modal on its own, so a surface that has no room for the field grid (the
 *  exceptions panel) can still open the same comparison a phase card opens. Exported
 *  rather than duplicated: one modal, one legend, one set of rows. */
export function LocationComparisonModal({ open, onClose, evidence, contextLabel }: ModalProps) {
  const { driverFix, trackerFix, separationMetres, verdict, boundary } = evidence
  const separationText = separationMetres === null ? COMPARISON_UNAVAILABLE : formatSeparation(separationMetres)
  const boundaryDistance = boundaryDistanceMetres(evidence)
  const showBoundaryDistance = boundaryDistance !== null && !boundaryIsNearby(evidence)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Recorded locations: ${contextLabel}`}
      size="xl"
    >
      <div className={MODAL_GRID_COLUMNS_CLASS}>
        <LocationComparisonMap evidence={evidence} className={MAP_MODAL_HEIGHT_CLASS} />
        <div className="flex flex-col">
          <InfoRow label="Legend" value={legendText(boundary)} />
          <InfoRow label={FIX_LABELS.driver_phone} value={driverFix ? coordsValue(driverFix) : NO_FIX_RECORDED} mono />
          <InfoRow label={FIX_LABELS.horse_tracker} value={trackerFix ? coordsValue(trackerFix) : NO_FIX_RECORDED} mono />
          <InfoRow label="Driver–truck separation" value={separationText} />
          <InfoRow label="Truck precinct check" value={VERDICT_LABELS[verdict]} />
          <InfoRow label="Driver proximity" value={evidence.proximity ? PROXIMITY_LABELS[evidence.proximity] : separationMetres !== null ? 'Recorded source separation; proximity not evaluated.' : 'Unable to compare'} />
          {boundary && <InfoRow label={boundary.provenance === 'recorded_snapshot' ? 'Recorded boundary and policy' : MODAL_BOUNDARY_ROW_LABEL} value={modalBoundaryValue(boundary)} />}
          {showBoundaryDistance && boundaryDistance !== null && (
            <InfoRow label={MODAL_DISTANCE_ROW_LABEL} value={distanceToPrecinctValue(boundaryDistance)} />
          )}
          <div className="mt-auto pt-4">
            <Button variant="secondary" full onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function LocationEvidencePanel({ evidence, contextLabel, hideMapButton = false, showCoordinates = true }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const closeModal = () => setModalOpen(false)
  const { driverFix, trackerFix, separationMetres, verdict, boundary } = evidence
  const separationText = separationMetres === null ? COMPARISON_UNAVAILABLE : formatSeparation(separationMetres)
  return (
    <>
      {showCoordinates && <Field label={FIX_LABELS.driver_phone} value={driverFix ? coordsValue(driverFix) : NO_FIX_RECORDED} mono />}
      {showCoordinates && <Field label={FIX_LABELS.horse_tracker} value={trackerFix ? coordsValue(trackerFix) : NO_FIX_RECORDED} mono />}
      {driverFix && <Field label={`${FIX_LABELS.driver_phone} capture time`} value={captureValue(driverFix)} />}
      {trackerFix && <Field label={`${FIX_LABELS.horse_tracker} capture time`} value={captureValue(trackerFix)} />}

      <Field label="Driver–truck separation" value={separationText} />
      <Field label="Truck precinct check" value={VERDICT_LABELS[verdict]} />
      {evidence.proximity
        ? <Field label="Driver proximity" value={PROXIMITY_LABELS[evidence.proximity]} />
        : separationMetres !== null
          ? <Field label="Driver proximity" value="Recorded source separation; proximity not evaluated." />
          : <Field label="Driver proximity" value="Unable to compare" />}

      <Field label="Boundary" value={boundaryValue(boundary, evidence.assessmentRecorded)} span />

      {!hideMapButton && hasAnyFix(evidence) && (
        <div className="col-span-2 mt-1">
          <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
            {VIEW_ON_MAP_LABEL}
          </Button>
        </div>
      )}

      {!hideMapButton && (
        <LocationComparisonModal open={modalOpen} onClose={closeModal} evidence={evidence} contextLabel={contextLabel} />
      )}
    </>
  )
}
