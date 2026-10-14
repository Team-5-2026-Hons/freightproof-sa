import { Button } from '@/components/ui/Button'
import type { DemoStage, DemoStageKind } from '@/lib/dev/demo-stage'
import type { DevVehicle, RigScenarioRequest } from '@/lib/types/dev'

interface TrackerActionsProps {
  tripId: string
  stage: DemoStage
  vehicles: readonly DevVehicle[]
  busy: boolean
  onScenario: (body: RigScenarioRequest) => void
  onCheck: () => void
}

interface TrackerButton {
  label: string
  body: RigScenarioRequest
}

// Stages at which the truck is at a stop, so "at / 3 km from the stop" make sense.
const AT_STOP_KINDS: readonly DemoStageKind[] = ['before_departure', 'arrived', 'unloading', 'confirming']

/** The simulated trackers for this moment of the trip. Each press stages the whole rig
 *  and then runs the real road check, so any exception it records comes from the
 *  system reading the trackers, never from the button. */
export function TrackerActions({ tripId, stage, vehicles, busy, onScenario, onCheck }: TrackerActionsProps): React.ReactElement | null {
  const horse = vehicles.find(v => v.role === 'horse')
  const trailers = vehicles.filter(v => v.role === 'trailer')
  const buttons: TrackerButton[] = []
  const silentHorse: TrackerButton[] = horse
    ? [{ label: `Horse ${horse.registration} tracker silent`, body: { trip_id: tripId, scenario: 'silent', vehicle_id: horse.vehicle_id } }]
    : []

  if (stage.kind === 'on_road') {
    buttons.push({ label: 'Driving normally', body: { trip_id: tripId, scenario: 'en_route' } })
    trailers.forEach(t => buttons.push({
      label: `Trailer ${t.registration} uncoupled`,
      body: { trip_id: tripId, scenario: 'trailer_uncoupled', vehicle_id: t.vehicle_id },
    }))
    buttons.push(...silentHorse)
    if (stage.nextStop) {
      // So the driver's arrival on the phone passes its location check.
      buttons.push({
        label: `Truck reaches ${stage.nextStop.precinct_name}`,
        body: { trip_id: tripId, scenario: 'at_stop', trip_stop_id: stage.nextStop.trip_stop_id },
      })
    }
  } else if (stage.stop && AT_STOP_KINDS.includes(stage.kind)) {
    const stopId = stage.stop.trip_stop_id
    buttons.push({ label: `At ${stage.stop.precinct_name}`, body: { trip_id: tripId, scenario: 'at_stop', trip_stop_id: stopId } })
    buttons.push({ label: `3 km from ${stage.stop.precinct_name}`, body: { trip_id: tripId, scenario: 'away_from_stop', trip_stop_id: stopId } })
    if (stage.kind === 'before_departure') {
      buttons.push({ label: 'Truck leaves before departure', body: { trip_id: tripId, scenario: 'left_before_departure' } })
    }
    buttons.push(...silentHorse)
  }

  if (buttons.length === 0) return null
  return (
    <section aria-label="Tracker" className="space-y-2">
      <h3 className="font-medium">
        Tracker <span className="text-xs font-normal text-slate-500">(simulated — every finding comes from the real check)</span>
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {buttons.map(b => (
          <Button key={b.label} variant="secondary" disabled={busy} onClick={() => onScenario(b.body)}>{b.label}</Button>
        ))}
      </div>
      {stage.kind === 'on_road' && <Button variant="ghost" disabled={busy} onClick={onCheck}>Run tracker check</Button>}
    </section>
  )
}
