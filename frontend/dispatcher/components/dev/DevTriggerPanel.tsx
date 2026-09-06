'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useDevTriggers } from '@/lib/hooks/useDevTriggers'
import {
  DEMO_EXCEPTION_TYPES,
  isClosedPhaseStatus,
  PRECINCT_WAYPOINT_ID,
  type DevConsignment,
  type DevTripStop,
  type DevTripSummary,
  type MoveTruckResponse,
  type ScanDirection,
} from '@/lib/types/dev'

// Metres-to-kilometres switchover for the "distance from precinct" readout —
// "3200 m" is harder to eyeball at a glance (and on a projector) than "3.2 km".
const METRES_PER_KILOMETRE = 1000

// Formats MoveTruckResponse.distance_metres for display, or names the reason
// there is nothing to show (no fix at all, vs. a fix exactly at the precinct).
function formatDistance(distanceMetres: number | null): string {
  if (distanceMetres === null) return 'distance unknown'
  return distanceMetres >= METRES_PER_KILOMETRE
    ? `${(distanceMetres / METRES_PER_KILOMETRE).toFixed(1)} km from the precinct`
    : `${Math.round(distanceMetres)} m from the precinct`
}

// geofence_confirmed is a tri-state, not a boolean: null on the no_signal waypoint
// means no verdict was ever reached, which is a materially different fact from a
// verdict that was reached and failed — collapsing it to falsy would tell the
// operator a fix existed and failed the geofence when actually there was no fix.
function verdictLabel(confirmed: boolean | null): string {
  if (confirmed === null) return 'No verdict — tracker dark'
  return confirmed ? 'Geofence confirmed' : 'Geofence failed'
}

function verdictClassName(confirmed: boolean | null): string {
  if (confirmed === null) return 'text-amber-700'
  return confirmed ? 'text-emerald-700' : 'text-red-600'
}

interface DevTriggerPanelProps {
  /** Shown at the top so nobody mistakes this for a product surface. */
  readonly heading: string
}

// One row in the derived "what's happening" picker. Built from the trip's actual
// stops/consignments rather than an assumed origin/destination shape, so a
// multi-stop cross-dock trip gets the right options even though only a
// single-leg trip is demoed today.
interface ScanOption {
  key: string
  label: string
  stop: DevTripStop
  direction: ScanDirection
  disabled: boolean
  disabledReason: string | null
}

function optionKey(stopId: string, direction: ScanDirection): string {
  return `${stopId}::${direction}`
}

function directionPhrase(direction: ScanDirection, precinctName: string): string {
  return direction === 'out' ? `Loading at ${precinctName}` : `Unloading at ${precinctName}`
}

// Scan OUT is gated by the LOADING phase; scan IN is gated by CONFIRMATION, not
// unloading — confirmation is where the origin scan is reconciled against the
// destination scan (see orchestration/phase_gate.py GATED_PHASES). A scan IN
// therefore stays legal through the whole unloading phase, and only becomes
// illegal once confirmation itself is decided. This asymmetry is deliberate;
// gating scan IN on unloading instead would be the "obvious" but wrong fix.
//
// Scan IN also carries a second, EARLIER gate that scan OUT deliberately does not:
// the truck must have actually left the preceding stop before a destination scan
// makes sense (preceding_departure_status). Scan OUT gets no such early gate — a
// warehouse can legitimately load a truck before the driver has even activated the
// trip (mirrors the reasoning in backend/app/api/v1/endpoints/dev_triggers.py for
// why loading has no activation precondition) — so do not add one here "for
// symmetry"; the two directions are asymmetric on purpose.
function buildScanOptions(stops: readonly DevTripStop[]): ScanOption[] {
  const options: ScanOption[] = []
  for (const stop of stops) {
    if (stop.pickup_consignments.length > 0) {
      const disabled = isClosedPhaseStatus(stop.loading_phase_status)
      options.push({
        key: optionKey(stop.trip_stop_id, 'out'),
        label: directionPhrase('out', stop.precinct_name),
        stop,
        direction: 'out',
        disabled,
        disabledReason: disabled ? 'Loading is already complete at this stop.' : null,
      })
    }
    if (stop.delivery_consignments.length > 0) {
      // Order matters: "already complete" is checked first because it is the later,
      // more definitive state — a stop that has both departed AND finished
      // confirmation must report the confirmation reason, not the departure one.
      const alreadyComplete = isClosedPhaseStatus(stop.confirmation_phase_status)
      const notYetDeparted = !isClosedPhaseStatus(stop.preceding_departure_status)
      const disabled = alreadyComplete || notYetDeparted
      const disabledReason = alreadyComplete
        ? 'Confirmation is already complete at this stop.'
        : notYetDeparted
          ? "The truck hasn't departed yet."
          : null
      options.push({
        key: optionKey(stop.trip_stop_id, 'in'),
        label: directionPhrase('in', stop.precinct_name),
        stop,
        direction: 'in',
        disabled,
        disabledReason,
      })
    }
  }
  return options
}

// Trip picker label: reference, driver, route, phase — enough to pick the right
// trip without opening it first. Every part degrades independently rather than
// hiding the option, since a demo trip may lack a driver or have only one stop.
function tripOptionLabel(trip: DevTripSummary): string {
  const driver = trip.driver_full_name ?? 'no driver'
  const origin = trip.stops[0]?.precinct_name
  const destination = trip.stops.length > 1 ? trip.stops[trip.stops.length - 1]?.precinct_name : undefined
  const route = origin === undefined ? 'no stops' : destination === undefined ? origin : `${origin} → ${destination}`
  const phase = trip.current_phase ?? trip.status
  return `${trip.trip_reference} · ${driver} · ${route} · ${phase}`
}

// One waybill's tick breakdown at confirm time, computed once so the modal can
// render "n of m" and the mismatch/unmanifested warnings without recomputing
// from live state (which could shift under a fast double-click).
interface PendingScanWaybill {
  reference: string
  manifestTotal: number
  manifestTicked: number
  extraBarcodes: string[]
}

type PendingAction =
  | {
      kind: 'scan'
      buttonLabel: string
      stop: DevTripStop
      direction: ScanDirection
      barcodesByReference: Record<string, string[]>
      waybills: PendingScanWaybill[]
      // Set only by "scan everything": the tick state to adopt ON CONFIRM. Writing
      // it when the modal opens would destroy a hand-built selection the moment the
      // operator opened the modal to compare, with no way back after Cancel.
      ticksOnConfirm: Record<string, Set<string>> | null
    }
  | { kind: 'closeSession'; stop: DevTripStop; direction: ScanDirection }
  | { kind: 'exception'; exceptionType: string; description: string }
  | {
      kind: 'ppChange'
      reference: string
      manifest?: number
      poddate?: string
      failtype?: string
      parcelCount?: number
    }

function buildWaybillBreakdown(
  consignments: readonly DevConsignment[],
  barcodesByReference: Record<string, string[]>,
): PendingScanWaybill[] {
  return consignments.map((c) => {
    const selected = barcodesByReference[c.parcel_perfect_reference] ?? []
    const manifestSet = new Set(c.barcodes)
    return {
      reference: c.parcel_perfect_reference,
      manifestTotal: c.barcodes.length,
      manifestTicked: selected.filter((b) => manifestSet.has(b)).length,
      extraBarcodes: selected.filter((b) => !manifestSet.has(b)),
    }
  })
}

export function DevTriggerPanel({ heading }: DevTriggerPanelProps): React.ReactElement {
  const {
    trips, waypoints, isLoading, error, lastResult,
    loadTrips, triggerScan, closeScanSession, triggerPpChange, triggerException, flushMockState,
    loadWaypoints, moveTruck,
  } = useDevTriggers()

  const [tripId, setTripId] = useState<string>('')
  const [selectedOptionKey, setSelectedOptionKey] = useState<string>('')

  // The last waypoint successfully moved to, and the full response it produced.
  // Kept separately from `lastResult` (the panel-wide one-line status) because this
  // needs to stay on screen — precinct, distance, verdict — for as long as the
  // truck sits at that waypoint, not just until the next unrelated action.
  const [activeWaypointId, setActiveWaypointId] = useState<string | null>(null)
  const [moveTruckResult, setMoveTruckResult] = useState<MoveTruckResponse | null>(null)

  // Manifest barcodes ticked per waybill reference, and not-on-manifest barcodes
  // added per waybill reference. Both reset whenever the stop+direction selection
  // changes (see the effect below) so a stale tick set can never follow the
  // operator to a different stop.
  const [tickedByReference, setTickedByReference] = useState<Record<string, Set<string>>>({})
  const [extraByReference, setExtraByReference] = useState<Record<string, string[]>>({})
  const [extraInputByReference, setExtraInputByReference] = useState<Record<string, string>>({})
  const [extraErrorByReference, setExtraErrorByReference] = useState<Record<string, string | null>>({})

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const [ppReference, setPpReference] = useState<string>('')
  const [ppManifest, setPpManifest] = useState<string>('')
  const [ppPodDate, setPpPodDate] = useState<string>('')
  const [ppFailType, setPpFailType] = useState<string>('')
  const [ppParcelCount, setPpParcelCount] = useState<string>('')
  const [exceptionType, setExceptionType] = useState<string>(DEMO_EXCEPTION_TYPES[0])
  const [exceptionNote, setExceptionNote] = useState<string>('Raised from the dev panel.')

  useEffect(() => {
    void loadTrips()
  }, [loadTrips])

  useEffect(() => {
    void loadWaypoints()
  }, [loadWaypoints])

  // A moved-to waypoint and its position readout belong to whichever trip's device
  // was moved. Carrying it over to a newly selected trip would show one trip's
  // mock position while narrating a different one.
  useEffect(() => {
    setActiveWaypointId(null)
    setMoveTruckResult(null)
  }, [tripId])

  const selectedTrip = trips.find((t) => t.trip_id === tripId) ?? null

  const scanOptions = useMemo<ScanOption[]>(
    () => buildScanOptions(selectedTrip?.stops ?? []),
    [selectedTrip],
  )

  const selectedOption = useMemo<ScanOption | null>(
    () => scanOptions.find((o) => o.key === selectedOptionKey) ?? null,
    [scanOptions, selectedOptionKey],
  )

  const consignmentsForSelection = useMemo<DevConsignment[]>(() => {
    if (selectedOption === null) return []
    return selectedOption.direction === 'out'
      ? selectedOption.stop.pickup_consignments
      : selectedOption.stop.delivery_consignments
  }, [selectedOption])

  // All manifest barcodes start ticked (spec: "all ticked by default") whenever the
  // selection changes; not-on-manifest additions never carry over to a new stop.
  // This is state DERIVED from the selection, not a sync with an external system,
  // so it's adjusted directly during render (react.dev's "adjusting state when a
  // prop changes" pattern) rather than in a useEffect, which would cost an extra
  // render pass and trip react-hooks/set-state-in-effect.
  const [resetForKey, setResetForKey] = useState<string>(selectedOptionKey)
  if (resetForKey !== selectedOptionKey) {
    setResetForKey(selectedOptionKey)
    const nextTicked: Record<string, Set<string>> = {}
    for (const c of consignmentsForSelection) {
      nextTicked[c.parcel_perfect_reference] = new Set(c.barcodes)
    }
    setTickedByReference(nextTicked)
    setExtraByReference({})
    setExtraInputByReference({})
    setExtraErrorByReference({})
    // The PP waybill select below draws its options from the same selection, so a
    // reference held over from the previous stop renders as a blank select while
    // still arming the submit button against the invisible waybill.
    setPpReference('')
  }

  const selectionDisabled = selectedOption === null || selectedOption.disabled

  const toggleBarcode = (reference: string, barcode: string): void => {
    setTickedByReference((prev) => {
      const next = new Set(prev[reference] ?? [])
      if (next.has(barcode)) next.delete(barcode)
      else next.add(barcode)
      return { ...prev, [reference]: next }
    })
  }

  // Rejects two inputs that look harmless and corrupt the payload:
  // a barcode already on the manifest is a tick, not an extra — counting it as one
  // pushes manifestTicked past manifestTotal in the confirm modal, hides the
  // "not on the manifest" warning, and sends a duplicate that inflates
  // observed_count (_reconcile_consignment measures len(observed_barcodes) without
  // deduping). A repeat of an existing extra collides on the React key, and
  // removeExtraBarcode filters by value, so unticking one row would delete both.
  const addExtraBarcode = (reference: string): void => {
    const value = (extraInputByReference[reference] ?? '').trim()
    if (value === '') return

    const manifest = consignmentsForSelection.find(
      (c) => c.parcel_perfect_reference === reference,
    )?.barcodes ?? []
    const rejection = manifest.includes(value)
      ? 'That barcode is on the manifest — untick it above instead of adding it.'
      : (extraByReference[reference] ?? []).includes(value)
        ? 'That barcode has already been added.'
        : null
    if (rejection !== null) {
      setExtraErrorByReference((prev) => ({ ...prev, [reference]: rejection }))
      return
    }

    setExtraErrorByReference((prev) => ({ ...prev, [reference]: null }))
    setExtraByReference((prev) => ({ ...prev, [reference]: [...(prev[reference] ?? []), value] }))
    setExtraInputByReference((prev) => ({ ...prev, [reference]: '' }))
  }

  const removeExtraBarcode = (reference: string, barcode: string): void => {
    setExtraByReference((prev) => ({
      ...prev,
      [reference]: (prev[reference] ?? []).filter((b) => b !== barcode),
    }))
  }

  // Builds the per-waybill payload from current tick state. Every ticked
  // consignment sends its FULL list (manifest + extras) because
  // MockScanFeed.stage_scans replaces prior staging rather than appending — see
  // the comment on ScanTriggerRequest.barcodes_by_reference in lib/types/dev.ts.
  const buildBarcodesByReference = (consignments: readonly DevConsignment[]): Record<string, string[]> => {
    const result: Record<string, string[]> = {}
    for (const c of consignments) {
      const ticked = tickedByReference[c.parcel_perfect_reference] ?? new Set(c.barcodes)
      const extras = extraByReference[c.parcel_perfect_reference] ?? []
      result[c.parcel_perfect_reference] = [...c.barcodes.filter((b) => ticked.has(b)), ...extras]
    }
    return result
  }

  const openTriggerScanConfirm = (): void => {
    if (selectedOption === null) return
    const barcodesByReference = buildBarcodesByReference(consignmentsForSelection)
    setPendingAction({
      kind: 'scan',
      buttonLabel: 'Trigger scan',
      stop: selectedOption.stop,
      direction: selectedOption.direction,
      barcodesByReference,
      waybills: buildWaybillBreakdown(consignmentsForSelection, barcodesByReference),
      ticksOnConfirm: null,
    })
  }

  const openScanEverythingConfirm = (): void => {
    if (selectedOption === null) return
    // Convenience path: what fires is the full manifest with extras dropped,
    // regardless of what was ticked before. The payload is built here; the matching
    // tick state is only adopted if the operator actually confirms.
    const nextTicked: Record<string, Set<string>> = {}
    const barcodesByReference: Record<string, string[]> = {}
    for (const c of consignmentsForSelection) {
      nextTicked[c.parcel_perfect_reference] = new Set(c.barcodes)
      barcodesByReference[c.parcel_perfect_reference] = [...c.barcodes]
    }
    setPendingAction({
      kind: 'scan',
      buttonLabel: 'Scan everything at this stop',
      stop: selectedOption.stop,
      direction: selectedOption.direction,
      barcodesByReference,
      waybills: buildWaybillBreakdown(consignmentsForSelection, barcodesByReference),
      ticksOnConfirm: nextTicked,
    })
  }

  const openCloseSessionConfirm = (): void => {
    if (selectedOption === null) return
    setPendingAction({ kind: 'closeSession', stop: selectedOption.stop, direction: selectedOption.direction })
  }

  const openExceptionConfirm = (): void => {
    if (tripId === '') return
    setPendingAction({ kind: 'exception', exceptionType, description: exceptionNote })
  }

  const openPpChangeConfirm = (): void => {
    if (ppReference === '') return
    setPendingAction({
      kind: 'ppChange',
      reference: ppReference,
      manifest: ppManifest === '' ? undefined : Number.parseInt(ppManifest, 10),
      poddate: ppPodDate === '' ? undefined : ppPodDate,
      failtype: ppFailType === '' ? undefined : ppFailType,
      parcelCount: ppParcelCount === '' ? undefined : Number.parseInt(ppParcelCount, 10),
    })
  }

  // Deliberately bypasses the Modal/PendingAction confirmation flow every other
  // write action in this panel goes through. FP-199: this control is narrated
  // live off a projector during a demo, and its whole point is "one press, one
  // move" — a confirm-then-click round trip would turn an instant demo beat into
  // a fumbled two-step one for no safety benefit (it only ever writes mock
  // tracker state, never anything evidentiary).
  const onMoveTruck = async (waypointId: string): Promise<void> => {
    if (tripId === '') return
    const result = await moveTruck({ trip_id: tripId, waypoint_id: waypointId })
    if (result !== null) {
      setActiveWaypointId(waypointId)
      setMoveTruckResult(result)
    }
  }

  const onConfirmPendingAction = async (): Promise<void> => {
    if (pendingAction === null) return
    switch (pendingAction.kind) {
      case 'scan': {
        if (pendingAction.ticksOnConfirm !== null) {
          setTickedByReference(pendingAction.ticksOnConfirm)
          setExtraByReference({})
          setExtraErrorByReference({})
        }
        const result = await triggerScan({
          trip_id: tripId,
          trip_stop_id: pendingAction.stop.trip_stop_id,
          direction: pendingAction.direction,
          barcodes_by_reference: pendingAction.barcodesByReference,
        })
        // A scan can decide the phase this stop is gated on, and buildScanOptions
        // reads exactly those statuses to decide what stays selectable. Without a
        // refresh the picker keeps offering a stop the scan just closed — the case
        // the gating was added to prevent.
        if (result !== null) await loadTrips({ silent: true })
        break
      }
      case 'closeSession': {
        const result = await closeScanSession({
          trip_id: tripId,
          trip_stop_id: pendingAction.stop.trip_stop_id,
          direction: pendingAction.direction,
        })
        if (result !== null) await loadTrips({ silent: true })
        break
      }
      case 'exception':
        await triggerException({
          trip_id: tripId,
          exception_type: pendingAction.exceptionType,
          description: pendingAction.description,
        })
        break
      case 'ppChange':
        await triggerPpChange({
          trip_id: tripId,
          parcel_perfect_reference: pendingAction.reference,
          manifest: pendingAction.manifest,
          poddate: pendingAction.poddate,
          failtype: pendingAction.failtype,
          parcel_count: pendingAction.parcelCount,
        })
        break
    }
    setPendingAction(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-slate-500">
            Every button here drives a mock and then calls the same orchestration the
            real flow calls. Nothing writes to the database directly. Every write
            action asks for confirmation first — nothing fires on a single click.
          </p>
          {error !== null && (
            <p role="alert" className="text-sm text-red-600">{error}</p>
          )}
          {lastResult !== null && (
            <p className="text-sm text-emerald-700">{lastResult}</p>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Target</h3>
          <Select
            label="Trip"
            value={tripId}
            onChange={(e) => { setTripId(e.target.value); setSelectedOptionKey('') }}
          >
            <option value="">Select a trip…</option>
            {trips.map((trip) => (
              <option key={trip.trip_id} value={trip.trip_id}>{tripOptionLabel(trip)}</option>
            ))}
          </Select>

          <Select
            label="What's happening"
            value={selectedOptionKey}
            onChange={(e) => setSelectedOptionKey(e.target.value)}
            disabled={scanOptions.length === 0}
          >
            <option value="">
              {scanOptions.length === 0 ? 'No loading/unloading actions on this trip' : 'Select…'}
            </option>
            {scanOptions.map((option) => (
              <option key={option.key} value={option.key} disabled={option.disabled}>
                {option.label}{option.disabled ? ` — ${option.disabledReason ?? 'blocked'}` : ''}
              </option>
            ))}
          </Select>
          {selectedOption !== null && selectedOption.disabledReason !== null && (
            <p role="alert" className="text-xs text-amber-700">{selectedOption.disabledReason}</p>
          )}

          <Button onClick={() => void loadTrips()} disabled={isLoading}>
            Refresh trips
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">Move the truck (dev-mode simulation)</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              Dev only — simulated tracker
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Writes a fake Pulsit position for the selected trip&apos;s device only.
            Everything downstream — the geofence check, the corroboration verdict,
            the phase handshake — is the real orchestration running against that
            fake position, exactly as it would against a genuine tracker fix.
          </p>

          {tripId === '' ? (
            <p className="text-xs text-slate-500">Select a trip above to move its truck.</p>
          ) : waypoints.length === 0 ? (
            <p className="text-xs text-slate-500">
              No waypoints available (is DEV_PANEL_ENABLED and PULSE_USE_MOCK set on the backend?)
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[...waypoints].sort((a, b) => a.sequence - b.sequence).map((wp) => {
                const isActive = activeWaypointId === wp.waypoint_id
                return (
                  <Button
                    key={wp.waypoint_id}
                    variant={isActive ? 'success' : 'secondary'}
                    size="lg"
                    full
                    disabled={isLoading}
                    onClick={() => void onMoveTruck(wp.waypoint_id)}
                  >
                    <span className="flex w-full flex-col items-start gap-0.5 text-left">
                      <span className="flex items-center gap-2 text-base font-semibold">
                        {wp.label}
                        {isActive && (
                          <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                            Active
                          </span>
                        )}
                      </span>
                      <span className="text-xs font-normal opacity-80">{wp.description}</span>
                    </span>
                  </Button>
                )
              })}
            </div>
          )}

          <Button
            variant="ghost"
            onClick={() => void onMoveTruck(PRECINCT_WAYPOINT_ID)}
            disabled={tripId === '' || isLoading}
          >
            Reset to precinct
          </Button>

          {moveTruckResult !== null && (
            <div className="space-y-1 rounded-lg border border-outline-v/20 p-3">
              <p className="text-sm font-semibold">
                {moveTruckResult.vehicle_registration} · {moveTruckResult.precinct_name}
              </p>
              <p className="text-xs text-slate-500">
                {/* Separate spans (not one interpolated string) so "No fix" stays an
                    independently-matchable text node rather than being fused with the
                    distance readout next to it. */}
                <span>
                  {moveTruckResult.has_position && moveTruckResult.latitude !== null && moveTruckResult.longitude !== null
                    ? `${moveTruckResult.latitude}, ${moveTruckResult.longitude}`
                    : 'No fix'}
                </span>
                {' · '}
                <span>{formatDistance(moveTruckResult.distance_metres)}</span>
              </p>
              <p className={`text-xs font-medium ${verdictClassName(moveTruckResult.geofence_confirmed)}`}>
                {verdictLabel(moveTruckResult.geofence_confirmed)} — {moveTruckResult.verdict_reason}
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Warehouse scan feed</h3>
          {selectedOption === null ? (
            <p className="text-xs text-slate-500">
              Pick a trip and a stop/direction above to see its waybills.
            </p>
          ) : consignmentsForSelection.length === 0 ? (
            <p className="text-xs text-slate-500">No consignments to scan at this stop.</p>
          ) : (
            <div className="space-y-4">
              {consignmentsForSelection.map((c) => (
                <div key={c.consignment_id} className="rounded-lg border border-outline-v/20 p-3 space-y-2">
                  <p className="text-sm font-semibold">{c.parcel_perfect_reference}</p>
                  <div className="space-y-1">
                    {c.barcodes.map((barcode) => (
                      <label key={barcode} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-sec"
                          checked={(tickedByReference[c.parcel_perfect_reference] ?? new Set()).has(barcode)}
                          onChange={() => toggleBarcode(c.parcel_perfect_reference, barcode)}
                        />
                        {barcode}
                      </label>
                    ))}
                    {(extraByReference[c.parcel_perfect_reference] ?? []).map((barcode) => (
                      <label key={barcode} className="flex items-center gap-2 text-sm cursor-pointer text-amber-700">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-sec"
                          checked
                          onChange={() => removeExtraBarcode(c.parcel_perfect_reference, barcode)}
                        />
                        {barcode} (not on manifest)
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 items-end">
                    <Input
                      id={`extra-barcode-${c.consignment_id}`}
                      label="Add barcode not on manifest"
                      value={extraInputByReference[c.parcel_perfect_reference] ?? ''}
                      placeholder="Stray barcode"
                      onChange={(e) => {
                        setExtraInputByReference((prev) => (
                          { ...prev, [c.parcel_perfect_reference]: e.target.value }
                        ))
                        // Editing is the operator answering the rejection; keeping it
                        // on screen would read as if the new value were rejected too.
                        setExtraErrorByReference((prev) => (
                          { ...prev, [c.parcel_perfect_reference]: null }
                        ))
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => addExtraBarcode(c.parcel_perfect_reference)}
                      disabled={selectionDisabled}
                    >
                      Add
                    </Button>
                  </div>
                  {(extraErrorByReference[c.parcel_perfect_reference] ?? null) !== null && (
                    <p role="alert" className="text-xs text-amber-700">
                      {extraErrorByReference[c.parcel_perfect_reference]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={openTriggerScanConfirm}
              disabled={selectionDisabled || isLoading || consignmentsForSelection.length === 0}
            >
              Trigger scan
            </Button>
            <Button
              variant="secondary"
              onClick={openScanEverythingConfirm}
              disabled={selectionDisabled || isLoading || consignmentsForSelection.length === 0}
            >
              Scan everything at this stop
            </Button>
          </div>

          {/* Visually distinct from the scan triggers above — this is the control that
              actually unblocks the driver's phase gate, which is a much bigger action
              than staging one more scan. */}
          <Button
            variant="danger"
            onClick={openCloseSessionConfirm}
            disabled={selectionDisabled || isLoading}
          >
            Close scan session — unblocks the driver
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Parcel Perfect lifecycle</h3>
          <Select label="Waybill" value={ppReference} onChange={(e) => setPpReference(e.target.value)}>
            <option value="">Select a waybill…</option>
            {consignmentsForSelection.map((c) => (
              <option key={c.parcel_perfect_reference} value={c.parcel_perfect_reference}>
                {c.parcel_perfect_reference}
              </option>
            ))}
          </Select>
          <Input
            label="Manifest number"
            type="number"
            value={ppManifest}
            placeholder="e.g. 999"
            onChange={(e) => setPpManifest(e.target.value)}
          />
          <Input
            label="POD date"
            value={ppPodDate}
            placeholder="e.g. 04/08/2026"
            onChange={(e) => setPpPodDate(e.target.value)}
          />
          <Input
            label="Failure reason"
            value={ppFailType}
            placeholder="e.g. Receiver not home"
            onChange={(e) => setPpFailType(e.target.value)}
          />
          <Input
            label="Edit waybill: new parcel count"
            type="number"
            value={ppParcelCount}
            placeholder="e.g. 27"
            onChange={(e) => setPpParcelCount(e.target.value)}
          />
          <Button onClick={openPpChangeConfirm} disabled={ppReference === '' || isLoading}>
            Apply PP change and re-sync
          </Button>
          <p className="text-xs text-slate-500">
            Editing the parcel count reproduces the verified 2026-08-04 finding: PP
            waybills are mutable after creation and the sync adopts the new figure.
            Drift detection is a separate ticket.
          </p>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Exceptions</h3>
          <Select
            label="Exception type"
            value={exceptionType}
            onChange={(e) => setExceptionType(e.target.value)}
          >
            {DEMO_EXCEPTION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </Select>
          <Input
            label="Description"
            value={exceptionNote}
            onChange={(e) => setExceptionNote(e.target.value)}
          />
          <Button onClick={openExceptionConfirm} disabled={tripId === '' || isLoading}>
            Raise exception
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Mock state</h3>
          <Button onClick={() => void flushMockState()} disabled={isLoading}>
            Clear staged mock state
          </Button>
          <p className="text-xs text-slate-500">
            Clears only the simulated outside world. Scans, exceptions and phase
            history already recorded stay exactly as they are.
          </p>
        </div>
      </Card>

      <Modal
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title="Confirm this trigger"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button variant="danger" loading={isLoading} onClick={() => void onConfirmPendingAction()}>
              Confirm
            </Button>
          </>
        }
      >
        {pendingAction !== null && (
          <div className="space-y-3">
            {pendingAction.kind === 'scan' && (
              <>
                <p className="font-medium">
                  {pendingAction.buttonLabel} — {directionPhrase(pendingAction.direction, pendingAction.stop.precinct_name)}
                </p>
                <ul className="space-y-2">
                  {pendingAction.waybills.map((wb) => (
                    <li key={wb.reference} className="text-sm">
                      <p>{wb.reference}: {wb.manifestTicked} of {wb.manifestTotal} parcels ticked</p>
                      {/* A waybill with NOTHING scanned raises nothing here:
                          _reconcile_consignment guards on `if events and (missing or
                          unexpected)`, and an empty stage produces no events. That
                          case is caught later, at loading close, by a different
                          exception — so promising a mismatch here would be a lie. */}
                      {wb.manifestTicked < wb.manifestTotal &&
                        (wb.manifestTicked > 0 || wb.extraBarcodes.length > 0) && (
                        <p className="text-xs text-amber-700">
                          This will raise a PARCEL_COUNT_MISMATCH exception.
                        </p>
                      )}
                      {wb.manifestTicked === 0 && wb.extraBarcodes.length === 0 && (
                        <p className="text-xs text-amber-700">
                          Nothing scanned for this waybill — no exception is raised now.
                          It is caught when the phase closes.
                        </p>
                      )}
                      {wb.extraBarcodes.length > 0 && (
                        <p className="text-xs text-amber-700">
                          Includes barcode(s) not on the manifest: {wb.extraBarcodes.join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pendingAction.kind === 'closeSession' && (
              <p>
                Close the scan session for {directionPhrase(pendingAction.direction, pendingAction.stop.precinct_name)}.
                This unblocks the driver&apos;s phase gate immediately.
              </p>
            )}
            {pendingAction.kind === 'exception' && (
              <p>
                Raise a <strong>{pendingAction.exceptionType}</strong> exception on this trip: &ldquo;{pendingAction.description}&rdquo;
              </p>
            )}
            {pendingAction.kind === 'ppChange' && (
              <p>Apply the staged change to waybill <strong>{pendingAction.reference}</strong> and re-sync.</p>
            )}
            <p className="text-xs text-slate-500">
              This writes real parcel statuses and can raise real exceptions.
              &ldquo;Clear staged mock state&rdquo; does not undo it.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
