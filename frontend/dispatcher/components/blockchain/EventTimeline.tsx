'use client'

// Ordered list of vehicle or driver events.
// Default view (all dispatchers): title + timestamp + humanized changed-fields rows —
// every dispatcher needs to see what actually changed, not just that something did.
// Forensic detail (admin + forensic mode ON only): BlockchainBadge — the chain-anchoring
// plumbing, not needed to understand the record itself.

import { Ic } from '@/components/ui/Ic'
import { BlockchainBadge } from './BlockchainBadge'
import { ForensicOnly } from './ForensicOnly'
import { describeChange } from '@/lib/forensic/describeChange'
import type { BlockchainReceipt, DriverEvent, VehicleEvent } from '@shared/lib/types/blockchain'

type Event = VehicleEvent | DriverEvent

type Props = {
  events: Event[]
  receipts: BlockchainReceipt[]
  className?: string
}

function describeEvent(e: Event): string {
  const t = e.event_type
  if (t === 'created') return 'Created'
  if (t === 'license_plate_changed') return 'Licence plate changed'
  if (t === 'license_disc_renewed') return 'Licence disc renewed'
  if (t === 'license_renewed') return 'Driver licence renewed'
  if (t === 'vin_updated') return 'VIN updated'
  if (t === 'vehicle_updated') return 'Vehicle details updated'
  if (t === 'deactivated') return 'Deactivated'
  if (t === 'cosmetic_update') return 'vehicle_id' in e ? 'Vehicle details updated' : 'Cosmetic update'
  return t
}

export function EventTimeline({ events, receipts, className = '' }: Props) {
  const receiptByEvent = new Map<string, BlockchainReceipt>()
  for (const r of receipts) {
    if (r.subject_type === 'vehicle_event' || r.subject_type === 'driver_event') {
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
            {/* Title row: event name left, timestamp right — visible to all dispatchers */}
            <div className="flex items-start justify-between gap-3">
              <div className="text-[13px] font-[600] text-on-surf">{describeEvent(e)}</div>
              <div className="shrink-0 flex items-center gap-[4px] text-[12px] font-[600] tabular-nums tracking-[0.03em] text-sec">
                <Ic n="clock" s={11} className="text-sec shrink-0" />
                {new Date(e.created_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
            {/* What changed — visible to every dispatcher, not just forensic mode */}
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
            {/* Hedera anchor ref is forensic detail — admin + forensic mode ON only */}
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
