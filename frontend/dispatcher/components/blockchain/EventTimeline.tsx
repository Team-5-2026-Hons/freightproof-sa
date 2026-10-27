'use client'

// Ordered list of vehicle, driver or precinct events.
// Default view (all dispatchers): title + timestamp + humanized changed-fields rows —
// every dispatcher needs to see what actually changed, not just that something did.
// Forensic detail (admin + forensic mode ON only): BlockchainBadge — the chain-anchoring
// plumbing, not needed to understand the record itself.

import { Ic } from '@/components/ui/Ic'
import { BlockchainBadge } from './BlockchainBadge'
import { ForensicOnly } from './ForensicOnly'
import { describeChange } from '@/lib/forensic/describeChange'
import { fmtSastDateTime } from '@shared/lib/utils/datetime'
import type {
  BlockchainReceipt, DriverEvent, PrecinctEvent, VehicleEvent,
} from '@shared/lib/types/blockchain'

type Event = VehicleEvent | DriverEvent | PrecinctEvent

type Props = {
  events: Event[]
  receipts: BlockchainReceipt[]
  className?: string
}

function describeEvent(e: Event): string {
  const t = e.event_type
  const isPrecinct = 'precinct_id' in e
  if (t === 'created') return isPrecinct ? 'Precinct mapped' : 'Created'
  if (t === 'license_plate_changed') return 'Licence plate changed'
  if (t === 'license_disc_renewed') return 'Licence disc renewed'
  if (t === 'license_renewed') return 'Driver licence renewed'
  if (t === 'vin_updated') return 'VIN updated'
  if (t === 'vehicle_updated') return 'Vehicle details updated'
  if (t === 'deactivated') return 'Deactivated'
  if (t === 'relocated') return 'Location corrected'
  if (t === 'geofence_resized') return 'Geofence radius changed'
  if (t === 'geofence_reshaped') return 'Property outline changed'
  if (t === 'sharing_changed') return 'Cross-organisation sharing changed'
  if (t === 'cosmetic_update') {
    if (isPrecinct) return 'Precinct details updated'
    return 'vehicle_id' in e ? 'Vehicle details updated' : 'Driver details updated'
  }
  return t
}

export function EventTimeline({ events, receipts, className = '' }: Props) {
  const receiptByEvent = new Map<string, BlockchainReceipt>()
  for (const r of receipts) {
    if (
      r.subject_type === 'vehicle_event' ||
      r.subject_type === 'driver_event' ||
      r.subject_type === 'precinct_event'
    ) {
      receiptByEvent.set(r.subject_id, r)
    }
  }

  if (events.length === 0) {
    return (
      <div className={`text-[13px] text-on-surf-v ${className}`}>No events recorded yet.</div>
    )
  }

  return (
    <ol className={`space-y-[8px] ${className}`}>
      {events.map((e) => {
        const receipt = receiptByEvent.get(e.id) ?? null
        const changeRows = describeChange(e.changed_fields)
        return (
          <li key={e.id} className="rounded-lg bg-surf-low p-[12px_14px]">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[13px] font-[600] text-on-surf">{describeEvent(e)}</div>
              <div className="shrink-0 flex items-center gap-[4px] text-[12px] font-[600] tabular-nums tracking-[0.03em] text-sec">
                <Ic n="clock" s={11} className="text-sec shrink-0" />
                {fmtSastDateTime(e.created_at) ?? '—'}
              </div>
            </div>
            {changeRows.length > 0 && (
              <div className="mt-[8px] space-y-[4px]">
                {changeRows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-on-surf-v">{row.label}</span>
                    <span className="font-[500] text-on-surf text-right">{row.value}</span>
                  </div>
                ))}
              </div>
            )}
            <ForensicOnly>
              <div className="mt-[8px]">
                <BlockchainBadge receipt={receipt} />
              </div>
            </ForensicOnly>
          </li>
        )
      })}
    </ol>
  )
}
