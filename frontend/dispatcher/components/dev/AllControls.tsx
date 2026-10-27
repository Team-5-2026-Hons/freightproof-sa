'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import type { UseDevTriggersResult } from '@/lib/hooks/useDevTriggers'
import {
  DEMO_EXCEPTION_TYPES,
  DEV_TRUCK_SCENARIOS,
  isClosedPhaseStatus,
  NO_STOP_REQUIRED_SCENARIO,
  PHONE_PLACEMENT_LABELS,
  PHONE_PLACEMENTS,
  SCENARIO_LABELS,
  STOP_REQUIRED_PLACEMENT,
  type DevConsignment,
  type DevPhonePlacement,
  type DevTripStop,
  type DevTruckScenario,
  type MovePhoneResponse,
  type MoveTruckResponse,
  type ScanDirection,
} from '@/lib/types/dev'

const METRES_PER_KILOMETRE = 1000

function formatDistance(distanceMetres: number | null, fromLabel: string): string {
  if (distanceMetres === null) return `distance ${fromLabel} unknown`
  return distanceMetres >= METRES_PER_KILOMETRE
    ? `${(distanceMetres / METRES_PER_KILOMETRE).toFixed(1)} km ${fromLabel}`
    : `${Math.round(distanceMetres)} m ${fromLabel}`
}

function tripStopLabel(stop: DevTripStop, index: number, total: number): string {
  if (index === 0) return `At origin: ${stop.precinct_name}`
  if (index === total - 1) return `At destination: ${stop.precinct_name}`
  return `Stop ${stop.sequence}: ${stop.precinct_name}`
}

function scenarioActiveKey(scenario: DevTruckScenario, tripStopId: string): string {
  return `${scenario}::${tripStopId}`
}

function verdictLabel(confirmed: boolean | null): string {
  if (confirmed === null) return 'No verdict: tracker dark'
  return confirmed ? 'Geofence confirmed' : 'Geofence failed'
}

function verdictClassName(confirmed: boolean | null): string {
  if (confirmed === null) return 'text-amber-700'
  return confirmed ? 'text-emerald-700' : 'text-red-600'
}

interface AllControlsProps {
  readonly controls: UseDevTriggersResult
  readonly tripId: string
}

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
      const alreadyComplete = isClosedPhaseStatus(stop.confirmation_phase_status)
      const notYetArrived = !isClosedPhaseStatus(stop.arrival_phase_status)
      const disabled = alreadyComplete || notYetArrived
      const disabledReason = alreadyComplete
        ? 'Confirmation is already complete at this stop.'
        : notYetArrived
          ? "The driver hasn't completed arrival yet."
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

/**
 * The demo panel's raw controls: every trigger with its full set of knobs, each write
 * behind a confirmation modal. The parent (DevTriggerPanel) owns the trip picker, the
 * activity log and the reset; presets there cover the common demo moments, and this
 * is where anything else is done by hand.
 */
export function AllControls({ controls, tripId }: AllControlsProps): React.ReactElement {
  const {
    trips, isLoading,
    loadTrips, triggerScan, closeScanSession, triggerPpChange, triggerException, moveTruck, movePhone,
  } = controls

  const [selectedOptionKey, setSelectedOptionKey] = useState<string>('')

  const [activeScenarioKey, setActiveScenarioKey] = useState<string | null>(null)
  const [moveTruckResult, setMoveTruckResult] = useState<MoveTruckResponse | null>(null)
  const [phonePlacement, setPhonePlacement] = useState<DevPhonePlacement | ''>('')
  const [movePhoneResult, setMovePhoneResult] = useState<MovePhoneResponse | null>(null)

  const [selectedTripStopId, setSelectedTripStopId] = useState<string>('')

  const latestSelectionRef = useRef<{ tripId: string; selectedTripStopId: string }>({
    tripId, selectedTripStopId,
  })
  useEffect(() => {
    latestSelectionRef.current = { tripId, selectedTripStopId }
  }, [tripId, selectedTripStopId])

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

  const [resetForTripId, setResetForTripId] = useState<string>(tripId)
  if (resetForTripId !== tripId) {
    setResetForTripId(tripId)
    setSelectedOptionKey('')
    setActiveScenarioKey(null)
    setMoveTruckResult(null)
    setSelectedTripStopId('')
  }

  const [resetForTripStopId, setResetForTripStopId] = useState<string>(selectedTripStopId)
  if (resetForTripStopId !== selectedTripStopId) {
    setResetForTripStopId(selectedTripStopId)
    setActiveScenarioKey(null)
    setMoveTruckResult(null)
  }

  const selectedTrip = trips.find((t) => t.trip_id === tripId) ?? null

  const stopOptions = useMemo<DevTripStop[]>(() => selectedTrip?.stops ?? [], [selectedTrip])

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

  const addExtraBarcode = (reference: string): void => {
    const value = (extraInputByReference[reference] ?? '').trim()
    if (value === '') return

    const manifest = consignmentsForSelection.find(
      (c) => c.parcel_perfect_reference === reference,
    )?.barcodes ?? []
    const rejection = manifest.includes(value)
      ? 'That barcode is on the manifest. Untick it above instead of adding it.'
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

  const onMoveTruckScenario = async (scenario: DevTruckScenario): Promise<void> => {
    if (tripId === '') return
    const requiresStop = scenario !== NO_STOP_REQUIRED_SCENARIO
    if (requiresStop && selectedTripStopId === '') return

    const requestedTripId = tripId
    const requestedStopId = selectedTripStopId
    const result = await moveTruck({
      trip_id: tripId,
      scenario,
      trip_stop_id: selectedTripStopId === '' ? undefined : selectedTripStopId,
    })
    if (
      latestSelectionRef.current.tripId !== requestedTripId
      || latestSelectionRef.current.selectedTripStopId !== requestedStopId
    ) return
    if (result !== null) {
      setActiveScenarioKey(scenarioActiveKey(scenario, requestedStopId))
      setMoveTruckResult(result)
    }
  }

  const onMovePhone = async (placement: DevPhonePlacement): Promise<void> => {
    if (tripId === '') return
    if (placement === STOP_REQUIRED_PLACEMENT && selectedTripStopId === '') return

    const requestedTripId = tripId
    const result = await movePhone({
      trip_id: tripId,
      placement,
      trip_stop_id: placement === STOP_REQUIRED_PLACEMENT && selectedTripStopId !== ''
        ? selectedTripStopId
        : undefined,
    })
    if (latestSelectionRef.current.tripId !== requestedTripId) return
    if (result !== null) setMovePhoneResult(result)
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
          <h3 className="font-medium">Scan target</h3>
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
                {option.label}{option.disabled ? ` (${option.disabledReason ?? 'blocked'})` : ''}
              </option>
            ))}
          </Select>
          {selectedOption !== null && selectedOption.disabledReason !== null && (
            <p role="alert" className="text-xs text-amber-700">{selectedOption.disabledReason}</p>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">Move the truck (dev-mode simulation)</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              Dev only: simulated tracker
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Writes a fake Pulsit position for the selected trip&apos;s device only.
            Everything downstream (the geofence check, the corroboration verdict,
            the phase handshake) is the real orchestration running against that
            fake position, exactly as it would against a genuine tracker fix.
          </p>
          <p className="text-xs text-slate-500">
            This stages mock state for the DEVICE itself, not just this trip. Any
            other trip whose horse shares this same Pulsit tracker will observe the
            same staged position too.
          </p>

          {moveTruckResult !== null && (
            <div className="space-y-1 rounded-lg border border-outline-v/20 p-3">
              <p className="text-sm font-semibold">
                {moveTruckResult.vehicle_registration} · {moveTruckResult.waypoint_label}
              </p>
              <p className="text-xs text-slate-500">
                <span>
                  {moveTruckResult.has_position && moveTruckResult.latitude !== null && moveTruckResult.longitude !== null
                    ? `${moveTruckResult.latitude}, ${moveTruckResult.longitude}`
                    : 'No fix'}
                </span>
              </p>
              {moveTruckResult.target_precinct_name !== null && (
                <p className="text-xs text-slate-500">
                  Simulated target: {moveTruckResult.target_precinct_name}:{' '}
                  {formatDistance(moveTruckResult.target_distance_metres, 'from the simulated target')}
                </p>
              )}
              <p className="text-xs text-slate-500">
                Expected stop: {moveTruckResult.expected_precinct_name ?? moveTruckResult.precinct_name}:{' '}
                {formatDistance(moveTruckResult.distance_metres, 'from the expected stop')}
              </p>
              <p className={`text-xs font-medium ${verdictClassName(moveTruckResult.geofence_confirmed)}`}>
                {verdictLabel(moveTruckResult.geofence_confirmed)}, {moveTruckResult.verdict_reason}
              </p>
            </div>
          )}
        </div>
      </Card>

      {tripId !== '' && (
        <Card>
          <div className="space-y-3 p-4">
            <h3 className="font-medium">Move relative to a trip stop</h3>
            <p className="text-xs text-slate-500">
              Moves the horse only, to a position computed from one of THIS
              trip&apos;s own stops. The Tracker presets above move the whole rig.
            </p>

            {stopOptions.length === 0 ? (
              <p className="text-xs text-slate-500">This trip has no stops.</p>
            ) : (
              <Select
                label="Trip stop"
                value={selectedTripStopId}
                onChange={(e) => setSelectedTripStopId(e.target.value)}
              >
                <option value="">
                  Select a stop… (required for every scenario except &quot;No signal&quot;)
                </option>
                {stopOptions.map((stop, index) => (
                  <option key={stop.trip_stop_id} value={stop.trip_stop_id}>
                    {tripStopLabel(stop, index, stopOptions.length)}
                  </option>
                ))}
              </Select>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEV_TRUCK_SCENARIOS.map((scenario) => {
                const isActive = activeScenarioKey === scenarioActiveKey(scenario, selectedTripStopId)
                const requiresStop = scenario !== NO_STOP_REQUIRED_SCENARIO
                const disabled = isLoading || (requiresStop && selectedTripStopId === '')
                return (
                  <Button
                    key={scenario}
                    variant={isActive ? 'success' : 'secondary'}
                    size="lg"
                    full
                    disabled={disabled}
                    onClick={() => void onMoveTruckScenario(scenario)}
                  >
                    <span className="flex items-center gap-2 text-base font-semibold">
                      {SCENARIO_LABELS[scenario]}
                      {isActive && (
                        <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          Active
                        </span>
                      )}
                    </span>
                  </Button>
                )
              })}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">Move the phone (dev-mode simulation)</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              Dev only: recorded as simulated
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Places the DRIVER&apos;S PHONE for this trip, independently of the truck. Set
            it before the driver submits a phase and their capture is recorded at that
            precinct instead of wherever the handset actually is, which is what stops a
            demo walked far from any depot raising a location warning on every phase.
          </p>
          <p className="text-xs text-slate-500">
            Every phase completed while a position is staged is stored with{' '}
            <code>driver_position_source = &quot;simulated&quot;</code>, so a staged walk
            can always be told apart from a real one. &quot;Use the phone&apos;s real
            location&quot; releases it.
          </p>

          <Select
            label="Phone position"
            value={phonePlacement}
            onChange={(e) => setPhonePlacement(e.target.value as DevPhonePlacement | '')}
          >
            <option value="">Select a position…</option>
            {PHONE_PLACEMENTS.map((placement) => (
              <option key={placement} value={placement}>
                {PHONE_PLACEMENT_LABELS[placement]}
              </option>
            ))}
          </Select>

          {phonePlacement === STOP_REQUIRED_PLACEMENT && selectedTripStopId === '' && (
            <p role="alert" className="text-xs text-amber-700">
              Pick a trip stop above first. &quot;{PHONE_PLACEMENT_LABELS[STOP_REQUIRED_PLACEMENT]}&quot; needs one.
            </p>
          )}

          <Button
            variant="secondary"
            size="lg"
            full
            disabled={
              isLoading
              || tripId === ''
              || phonePlacement === ''
              || (phonePlacement === STOP_REQUIRED_PLACEMENT && selectedTripStopId === '')
            }
            onClick={() => { if (phonePlacement !== '') void onMovePhone(phonePlacement) }}
          >
            Apply to the phone
          </Button>

          {movePhoneResult !== null && (
            <div className="space-y-1 rounded-lg border border-outline-v/20 p-3">
              <p className="text-sm font-semibold">{movePhoneResult.placement_label}</p>
              {movePhoneResult.staged ? (
                <>
                  <p className="text-xs text-slate-500">
                    {movePhoneResult.precinct_name} · {movePhoneResult.latitude}, {movePhoneResult.longitude}
                  </p>
                  <p className="text-xs font-medium text-amber-700">
                    Phases completed now record driver_position_source = {movePhoneResult.recorded_as}
                  </p>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  The handset&apos;s own fix will be recorded again (device).
                </p>
              )}
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

          <Button
            variant="danger"
            onClick={openCloseSessionConfirm}
            disabled={selectionDisabled || isLoading}
          >
            Close scan session: unblocks the driver
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
                  {pendingAction.buttonLabel}: {directionPhrase(pendingAction.direction, pendingAction.stop.precinct_name)}
                </p>
                <ul className="space-y-2">
                  {pendingAction.waybills.map((wb) => (
                    <li key={wb.reference} className="text-sm">
                      <p>{wb.reference}: {wb.manifestTicked} of {wb.manifestTotal} parcels ticked</p>
                      {wb.manifestTicked < wb.manifestTotal &&
                        (wb.manifestTicked > 0 || wb.extraBarcodes.length > 0) && (
                        <p className="text-xs text-amber-700">
                          This will raise a PARCEL_COUNT_MISMATCH exception.
                        </p>
                      )}
                      {wb.manifestTicked === 0 && wb.extraBarcodes.length === 0 && (
                        <p className="text-xs text-amber-700">
                          Nothing scanned for this waybill. No exception is raised now.
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
              &ldquo;Reset simulated world&rdquo; does not undo it.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
