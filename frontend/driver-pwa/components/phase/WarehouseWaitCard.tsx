// frontend/driver-pwa/components/phase/WarehouseWaitCard.tsx
'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { useTrip } from '@/lib/hooks/useTrip'

interface WarehouseWaitCardProps {
  // Phase-specific body sentence — each caller says something different; this component
  // owns only the shell, never the wording.
  children: ReactNode
}

// Shared shell for the three gated-phase "waiting" screens, including the Check-now
// affordance for TripContext's auto-refresh (lib/hooks/useTripAutoRefresh.ts). Reads
// useTrip() itself so call sites stay dumb.
export function WarehouseWaitCard({ children }: WarehouseWaitCardProps) {
  const { refreshQuietly, isRefreshing, lastRefreshedAt } = useTrip()

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
      <p className="text-sm font-semibold">Waiting for the warehouse</p>
      <p className="text-sm text-surface-on-variant">{children}</p>
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-surface-on-variant" aria-live="polite">
          {isRefreshing ? 'Checking…' : lastCheckedLabel(lastRefreshedAt)}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refreshQuietly()} disabled={isRefreshing}>
          Check now
        </Button>
      </div>
    </div>
  )
}

function lastCheckedLabel(lastRefreshedAt: string | null): string {
  if (lastRefreshedAt === null) return ''
  // Absolute local time, not relative: avoids needing a ticking timer to stay honest.
  const time = new Date(lastRefreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Last checked ${time}`
}
