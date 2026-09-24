import { Button } from '@/components/ui/Button'
import { scanInOpen, scanOutOpen, type DemoStage } from '@/lib/dev/demo-stage'
import { barcodesForPreset, type ScanPreset } from '@/lib/dev/presets'
import type { CloseScanSessionRequest, ScanDirection, ScanTriggerRequest } from '@/lib/types/dev'

interface WarehouseActionsProps {
  tripId: string
  stage: DemoStage
  busy: boolean
  onScan: (body: ScanTriggerRequest) => void
  onCloseSession: (body: CloseScanSessionRequest) => void
}

const PRESET_LABELS: Record<ScanPreset, (direction: ScanDirection) => string> = {
  all: () => 'All parcels',
  one_short: (direction) => (direction === 'out' ? 'One parcel short' : 'One parcel missing'),
  stray: () => 'Stray parcel',
}

/** The warehouse's scan presets for the stop the truck is at: scan OUT before
 *  departure, scan IN once arrival is done. One click each — a preset is a named,
 *  known scenario; hand-built scans live under "All controls". */
export function WarehouseActions({ tripId, stage, busy, onScan, onCloseSession }: WarehouseActionsProps): React.ReactElement | null {
  const stop = stage.stop
  if (stop === null) return null

  const direction: ScanDirection | null =
    stage.kind === 'before_departure' && scanOutOpen(stop) ? 'out'
      : (stage.kind === 'unloading' || stage.kind === 'confirming') && scanInOpen(stop) ? 'in'
        : null

  if (direction === null) {
    return stage.kind === 'arrived' && stop.delivery_consignments.length > 0
      ? <p className="text-xs text-amber-700">Scanning in opens once the driver completes arrival — the seal is inspected before any door opens.</p>
      : null
  }

  const consignments = direction === 'out' ? stop.pickup_consignments : stop.delivery_consignments
  const target = { trip_id: tripId, trip_stop_id: stop.trip_stop_id, direction }
  return (
    <section aria-label="Warehouse" className="space-y-2">
      <h3 className="font-medium">Warehouse — scan {direction} at {stop.precinct_name}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.keys(PRESET_LABELS) as ScanPreset[]).map((preset) => (
          <Button key={preset} variant="secondary" disabled={busy}
            onClick={() => onScan({ ...target, barcodes_by_reference: barcodesForPreset(consignments, preset) })}>
            {PRESET_LABELS[preset](direction)}
          </Button>
        ))}
      </div>
      <Button variant="danger" disabled={busy} onClick={() => onCloseSession(target)}>
        Close scan session — unblocks the driver
      </Button>
    </section>
  )
}
