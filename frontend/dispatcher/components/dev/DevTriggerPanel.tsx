'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { demoStageFor } from '@/lib/dev/demo-stage'
import { useDevTriggers } from '@/lib/hooks/useDevTriggers'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { ActivityLog } from './ActivityLog'
import { AllControls } from './AllControls'
import { ParcelPerfectActions } from './ParcelPerfectActions'
import { StageHeader } from './StageHeader'
import { TrackerActions } from './TrackerActions'
import { TripPicker } from './TripPicker'
import { WarehouseActions } from './WarehouseActions'

interface DevTriggerPanelProps {
  /** Shown at the top so nobody mistakes this for a product surface. */
  readonly heading: string
}

/**
 * The demo panel: pick a trip, see where it is, and simulate only the outside world
 * that fits that moment. The driver always acts on the real phone; nothing here
 * creates driver evidence. Presets fire on one click; the raw controls under
 * "All controls" keep their confirmation step.
 */
export function DevTriggerPanel({ heading }: DevTriggerPanelProps): React.ReactElement {
  const controls = useDevTriggers()
  const { trips, isLoading, activity, loadTrips } = controls
  const [tripId, setTripId] = useState<string>('')

  useEffect(() => { void loadTrips({ silent: true }) }, [loadTrips])

  // Silent refresh on any event for this trip: the panel moves on when the driver acts.
  const refresh = useCallback(() => { void loadTrips({ silent: true }) }, [loadTrips])
  useLiveResource('trip', tripId === '' ? 'any' : tripId, refresh)

  // After a write, re-read the trip so the stage and gates reflect what just happened.
  // A null result means the call failed; there is nothing new to read.
  const thenRefresh = useCallback(<T,>(pending: Promise<T | null>): void => {
    void pending.then(result => { if (result !== null) refresh() })
  }, [refresh])

  const trip = trips.find(t => t.trip_id === tripId) ?? null
  const stage = trip === null ? null : demoStageFor(trip)

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-slate-500">
            Simulates the warehouse, Parcel Perfect and the trackers. The driver acts on the phone.
            Every action runs the same orchestration the real flow runs.
          </p>
          <TripPicker trips={trips} tripId={tripId} onChange={setTripId} />
          {trip !== null && stage !== null && <StageHeader trip={trip} stage={stage} />}
        </div>
      </Card>

      {trip !== null && stage !== null && (
        <Card>
          <div className="space-y-5 p-4">
            <WarehouseActions tripId={trip.trip_id} stage={stage} busy={isLoading}
              onScan={(body) => thenRefresh(controls.triggerScan(body))}
              onCloseSession={(body) => thenRefresh(controls.closeScanSession(body))} />
            <TrackerActions tripId={trip.trip_id} stage={stage} vehicles={trip.vehicles} busy={isLoading}
              onScenario={(body) => thenRefresh(controls.runRigScenario(body))}
              onCheck={() => thenRefresh(controls.runRoadCheck(trip.trip_id))} />
            <ParcelPerfectActions trip={trip} stage={stage} busy={isLoading}
              onPpChange={(body) => thenRefresh(controls.triggerPpChange(body))} />
            <Button variant="ghost" disabled={isLoading} onClick={() => void controls.flushMockState()}>
              Reset simulated world
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="space-y-2 p-4">
          <h3 className="font-medium">Activity</h3>
          <ActivityLog entries={activity} />
        </div>
      </Card>

      <details className="rounded-lg border border-outline-v/20 p-4">
        <summary className="cursor-pointer font-medium">All controls</summary>
        <div className="mt-4">
          <AllControls controls={controls} tripId={tripId} />
        </div>
      </details>
    </div>
  )
}
