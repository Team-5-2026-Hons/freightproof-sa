'use client'

// Ordered list of vehicle or driver events.
// Each row shows a human-readable label, timestamp, a BlockchainBadge when anchored,
// and the changed-fields snapshot in a compact monospace block.

import { Ic } from '@/components/ui/Ic'
import { BlockchainBadge } from './BlockchainBadge'
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
  if (t === 'vin_updated') return 'VIN updated'
  if (t === 'vehicle_updated') return 'Multiple fields updated'
  if (t === 'license_renewed') return 'Driver licence renewed'
  if (t === 'deactivated') return 'Deactivated'
  if (t === 'cosmetic_update') return 'Cosmetic update'
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
        return (
          <li key={e.id} className="rounded-lg bg-surf-lowest shadow-level-2 p-[12px_14px]">
            {/* Title row: event name left, timestamp right */}
            <div className="flex items-start justify-between gap-3">
              <div className="text-[13px] font-[600] text-on-surf">{describeEvent(e)}</div>
              <div className="shrink-0 flex items-center gap-[4px] text-[12px] font-[600] tabular-nums tracking-[0.03em] text-on-surf">
                <Ic n="clock" s={11} className="text-on-surf-v shrink-0" />
                {new Date(e.created_at).toLocaleString('en-ZA', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
            {/* Hedera ref below title */}
            <div className="mt-[4px]">
              <BlockchainBadge receipt={receipt} />
            </div>
            <pre className="mt-[8px] overflow-x-auto rounded bg-surf-low p-[8px] text-[11px] font-mono tracking-[0.02em] leading-relaxed text-on-surf-v">
              {JSON.stringify(e.changed_fields, null, 2)}
            </pre>
          </li>
        )
      })}
    </ol>
  )
}
