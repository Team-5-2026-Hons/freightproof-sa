import { Button } from '@/components/ui/Button'
import type { DemoStage } from '@/lib/dev/demo-stage'
import { ppRequestForPreset, type PpPreset } from '@/lib/dev/presets'
import type { DevConsignment, DevTripSummary, PpTriggerRequest } from '@/lib/types/dev'

interface ParcelPerfectActionsProps {
  trip: DevTripSummary
  stage: DemoStage
  busy: boolean
  onPpChange: (body: PpTriggerRequest) => void
}

const PRESET_LABELS: Record<PpPreset, string> = {
  parcel_added: 'Waybill edited in PP (+1 parcel)',
  delivered: 'Delivered (POD recorded)',
  delivery_failed: 'Delivery failed',
}

/** Each waybill once, whichever stops it is picked up or dropped at. */
function uniqueWaybills(trip: DevTripSummary): DevConsignment[] {
  const byReference = new Map<string, DevConsignment>()
  trip.stops.forEach(s => [...s.pickup_consignments, ...s.delivery_consignments]
    .forEach(c => byReference.set(c.parcel_perfect_reference, c)))
  return [...byReference.values()]
}

/** Parcel Perfect's side of each waybill. Delivery outcomes appear only once the trip
 *  is handing over or finished; a mid-trip waybill edit is available until then. */
export function ParcelPerfectActions({ trip, stage, busy, onPpChange }: ParcelPerfectActionsProps): React.ReactElement | null {
  const presets: PpPreset[] = stage.kind === 'closed' ? ['delivered', 'delivery_failed']
    : stage.kind === 'confirming' ? ['delivered', 'delivery_failed', 'parcel_added'] : ['parcel_added']
  const waybills = uniqueWaybills(trip)
  if (waybills.length === 0) return null

  return (
    <section aria-label="Parcel Perfect" className="space-y-2">
      <h3 className="font-medium">Parcel Perfect</h3>
      {waybills.map(waybill => (
        <div key={waybill.parcel_perfect_reference} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{waybill.parcel_perfect_reference}</span>
          {presets.map(preset => (
            <Button key={preset} size="sm" variant="secondary" disabled={busy}
              onClick={() => onPpChange(ppRequestForPreset(trip.trip_id, waybill, preset, new Date()))}>
              {PRESET_LABELS[preset]}
            </Button>
          ))}
        </div>
      ))}
    </section>
  )
}
