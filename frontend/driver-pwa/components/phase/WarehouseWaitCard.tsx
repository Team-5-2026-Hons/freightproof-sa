// frontend/driver-pwa/components/phase/WarehouseWaitCard.tsx
'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { useTrip } from '@/lib/hooks/useTrip'

interface WarehouseWaitCardProps {
  // Phase-specific body sentence — loading/Linehaul, unloading/VisualCount and
  // confirmation/Closed each say something different (scanning off the truck vs in at
  // this stop vs the trip will close) and that difference is deliberate; this component
  // owns only the shell, never the wording.
  children: ReactNode
}

// Shared shell for the three gated-phase "waiting" screens. All three were identical
// copy-paste — same card, same "Waiting for the warehouse" title, same
// `(phase.blocked_on ?? null) !== null` guard at the call site — and now all three also
// need the same Check-now/checking-status affordance that TripContext's auto-refresh
// makes meaningful (see lib/hooks/useTripAutoRefresh.ts): the card's own promise, "this
// will unlock on its own", is only true once something actually asks again.
//
// Reads useTrip() itself so the three call sites stay dumb — they pass their own body
// copy in and own nothing about refresh state.
export function WarehouseWaitCard({ children }: WarehouseWaitCardProps) {
  const { refreshQuietly, isRefreshing, lastRefreshedAt } = useTrip()

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
      <p className="text-sm font-semibold">Waiting for the warehouse</p>
      <p className="text-sm text-surface-on-variant">{children}</p>
      <div className="flex items-center justify-between gap-3 pt-1">
        {/* Honest status, not a guess: "Checking…" only while a request is actually in
            flight, otherwise the timestamp of the last one that landed — never an
            optimistic "up to date" claim the poll hasn't earned yet. */}
        <p className="text-xs text-surface-on-variant" aria-live="polite">
          {isRefreshing ? 'Checking…' : lastCheckedLabel(lastRefreshedAt)}
        </p>
        {/* Ghost + sm: this is an optional accelerator over a poll that already runs on
            its own, not the primary action on this screen — matches Button's own
            secondary/ghost-for-low-emphasis convention rather than competing visually
            with a real call to action. */}
        <Button type="button" variant="ghost" size="sm" onClick={() => void refreshQuietly()} disabled={isRefreshing}>
          Check now
        </Button>
      </div>
    </div>
  )
}

function lastCheckedLabel(lastRefreshedAt: string | null): string {
  if (lastRefreshedAt === null) return ''
  // Absolute local time, not a relative "x seconds ago" — a relative label goes stale the
  // moment it's rendered and would need its own ticking timer to stay honest, which is
  // more machinery than a courtesy hint justifies.
  const time = new Date(lastRefreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Last checked ${time}`
}
