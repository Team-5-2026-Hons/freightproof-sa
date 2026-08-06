'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useDevTriggers } from '@/lib/hooks/useDevTriggers'
import { DEMO_EXCEPTION_TYPES, type ScanDirection } from '@/lib/types/dev'

interface DevTriggerPanelProps {
  /** Shown at the top so nobody mistakes this for a product surface. */
  readonly heading: string
}

export function DevTriggerPanel({ heading }: DevTriggerPanelProps): React.ReactElement {
  const {
    trips, isLoading, error, lastResult,
    loadTrips, triggerScan, triggerPpChange, triggerException, flushMockState,
  } = useDevTriggers()

  const [tripId, setTripId] = useState<string>('')
  const [stopId, setStopId] = useState<string>('')
  const [direction, setDirection] = useState<ScanDirection>('out')
  const [parcelCount, setParcelCount] = useState<string>('')
  const [extraBarcode, setExtraBarcode] = useState<string>('')
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

  const selectedTrip = trips.find((t) => t.trip_id === tripId) ?? null
  const selectedStop = selectedTrip?.stops.find((s) => s.trip_stop_id === stopId) ?? null

  // References available at the selected stop, in the selected direction. Shown so
  // the operator picks a reference that actually exists there rather than typing one.
  const referencesAtStop = selectedStop
    ? direction === 'out'
      ? selectedStop.pickup_consignment_references
      : selectedStop.delivery_consignment_references
    : []

  const canScan = tripId !== '' && stopId !== ''

  const onFullScan = async (): Promise<void> => {
    await triggerScan({ trip_id: tripId, trip_stop_id: stopId, direction })
  }

  const onPartialScan = async (): Promise<void> => {
    const count = Number.parseInt(parcelCount, 10)
    if (Number.isNaN(count)) return
    await triggerScan({
      trip_id: tripId, trip_stop_id: stopId, direction, parcel_count: count,
    })
  }

  const onUnexpectedBarcode = async (): Promise<void> => {
    if (extraBarcode.trim() === '') return
    await triggerScan({
      trip_id: tripId, trip_stop_id: stopId, direction, barcodes: [extraBarcode.trim()],
    })
  }

  const onPpChange = async (): Promise<void> => {
    if (ppReference === '') return
    await triggerPpChange({
      trip_id: tripId,
      parcel_perfect_reference: ppReference,
      manifest: ppManifest === '' ? undefined : Number.parseInt(ppManifest, 10),
      poddate: ppPodDate === '' ? undefined : ppPodDate,
      failtype: ppFailType === '' ? undefined : ppFailType,
      parcel_count: ppParcelCount === '' ? undefined : Number.parseInt(ppParcelCount, 10),
    })
  }

  const onException = async (): Promise<void> => {
    if (tripId === '') return
    await triggerException({
      trip_id: tripId, exception_type: exceptionType, description: exceptionNote,
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-slate-500">
            Every button here drives a mock and then calls the same orchestration the
            real flow calls. Nothing writes to the database directly.
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
            onChange={(e) => { setTripId(e.target.value); setStopId('') }}
          >
            <option value="">Select a trip…</option>
            {trips.map((trip) => (
              <option key={trip.trip_id} value={trip.trip_id}>
                {trip.trip_reference} — {trip.status}
                {trip.current_phase !== null ? ` (${trip.current_phase})` : ''}
              </option>
            ))}
          </Select>
          <Select label="Stop" value={stopId} onChange={(e) => setStopId(e.target.value)}>
            <option value="">Select a stop…</option>
            {(selectedTrip?.stops ?? []).map((stop) => (
              <option key={stop.trip_stop_id} value={stop.trip_stop_id}>
                #{stop.sequence} — {stop.precinct_name}
              </option>
            ))}
          </Select>
          <Select
            label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as ScanDirection)}
          >
            <option value="out">Scan OUT (loading)</option>
            <option value="in">Scan IN (unloading)</option>
          </Select>
          {selectedStop !== null && (
            <p className="text-xs text-slate-500">
              Consignments here: {referencesAtStop.join(', ') || 'none'}
            </p>
          )}
          <Button onClick={() => void loadTrips()} disabled={isLoading}>
            Refresh trips
          </Button>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Warehouse scan feed</h3>
          <Button onClick={() => void onFullScan()} disabled={!canScan || isLoading}>
            Scan everything at this stop
          </Button>
          <div className="flex gap-2">
            <Input
              label="Parcels to scan"
              type="number"
              min={0}
              value={parcelCount}
              placeholder="N parcels"
              onChange={(e) => setParcelCount(e.target.value)}
            />
            <Button onClick={() => void onPartialScan()} disabled={!canScan || isLoading}>
              Partial scan
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              label="Unexpected barcode"
              value={extraBarcode}
              placeholder="Barcode not on the manifest"
              onChange={(e) => setExtraBarcode(e.target.value)}
            />
            <Button onClick={() => void onUnexpectedBarcode()} disabled={!canScan || isLoading}>
              Scan unexpected
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="font-medium">Parcel Perfect lifecycle</h3>
          <Select label="Waybill" value={ppReference} onChange={(e) => setPpReference(e.target.value)}>
            <option value="">Select a waybill…</option>
            {referencesAtStop.map((reference) => (
              <option key={reference} value={reference}>{reference}</option>
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
          <Button onClick={() => void onPpChange()} disabled={ppReference === '' || isLoading}>
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
          <Button onClick={() => void onException()} disabled={tripId === '' || isLoading}>
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
    </div>
  )
}
