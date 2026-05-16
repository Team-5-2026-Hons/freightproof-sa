'use client'

// Ordered list of vehicle or driver events, each showing a human-readable
// label, timestamp, changed-fields diff, and a BlockchainBadge if a receipt
// exists for that event.

import type { BlockchainReceipt, DriverEvent, VehicleEvent } from '@shared/lib/types/blockchain'
import { BlockchainBadge } from './BlockchainBadge'

// Union type so the component handles both vehicle and driver history tables.
type Event = VehicleEvent | DriverEvent

type Props = {
  events: Event[]
  receipts: BlockchainReceipt[]
  className?: string
}

// Maps event_type strings to display labels. Using an exhaustive if-chain keeps
// TypeScript's narrowing happy without requiring a lookup object that could go stale.
function describeEvent(e: Event): string {
  const t = e.event_type
  if (t === 'created') return 'Created'
  if (t === 'license_plate_changed') return 'License plate changed'
  if (t === 'license_disc_renewed') return 'Licence disc renewed'
  if (t === 'license_renewed') return 'Driver licence renewed'
  if (t === 'deactivated') return 'Deactivated'
  if (t === 'cosmetic_update') return 'Cosmetic update'
  return t
}

export function EventTimeline({ events, receipts, className = '' }: Props) {
  // Build a map of event_id → receipt for O(1) lookup per rendered row.
  // Only vehicle_event and driver_event subjects are expected here; others are filtered by subject_type.
  const receiptByEvent = new Map<string, BlockchainReceipt>()
  for (const r of receipts) {
    if (r.subject_type === 'vehicle_event' || r.subject_type === 'driver_event') {
      receiptByEvent.set(r.subject_id, r)
    }
  }
  return (
    <ol className={`space-y-2 ${className}`}>
      {events.map((e) => {
        const receipt = receiptByEvent.get(e.id) ?? null
        return (
          <li key={e.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white">{describeEvent(e)}</div>
                <div className="text-xs text-white/50">
                  {new Date(e.created_at).toUTCString()}
                </div>
              </div>
              <BlockchainBadge receipt={receipt} />
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-white/70">
              {JSON.stringify(e.changed_fields, null, 2)}
            </pre>
          </li>
        )
      })}
      {events.length === 0 && (
        <li className="text-sm text-white/40">No events recorded yet.</li>
      )}
    </ol>
  )
}
