// frontend/driver-pwa/components/phase/WarehouseWaitCard.tsx
'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Package } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'
import { useTrip } from '@/lib/hooks/useTrip'
import { backTarget } from '@/lib/navigation/back-stack'
import { markTransition } from '@/lib/navigation/transition-direction'

interface WarehouseWaitCardProps {
  /** What the warehouse is doing, as the screen's title ("Loading in progress"). */
  title: string
  // Phase-specific body sentence — each caller says something different; this component
  // owns only the shell, never the wording.
  children: ReactNode
}

// Shared shell for the three gated-phase "waiting" screens (overhaul 4.4), including the
// Check-now affordance for TripContext's auto-refresh (lib/hooks/useTripAutoRefresh.ts).
// It replaces the step's own title and body: while blocked, "Check the linehaul sheet" is
// not what is happening, so the screen says what is. Reads useTrip() itself so call sites
// stay dumb.
export function WarehouseWaitCard({ title, children }: WarehouseWaitCardProps) {
  const { refreshQuietly, isRefreshing, lastRefreshedAt } = useTrip()

  return (
    <div className="flex flex-1 flex-col items-center px-3 pt-16 text-center">
      {/* Amber, not red: nothing is wrong, the driver is simply early. */}
      <span className="relative flex size-24 items-center justify-center rounded-full bg-attention-tint text-attention-ink">
        <span aria-hidden className="absolute -inset-2 rounded-full ring-2 ring-inset ring-attention/30" />
        <Package className="size-10" strokeWidth={1.7} aria-hidden />
      </span>
      <h1 className="mt-7 text-title-1 tracking-tight text-surface-on">{title}</h1>
      <p className="mt-2.5 text-body text-surface-on-variant">{children}</p>
      <p className="mt-6 inline-flex h-9 items-center gap-2 rounded-full bg-fill px-3.5 text-subhead font-semibold text-surface-on">
        <span aria-hidden className="size-2 rounded-full bg-attention" />
        Waiting for the warehouse
      </p>
      <div className="mt-3 flex items-center gap-3">
        <p className="text-footnote text-surface-on-variant" aria-live="polite">
          {isRefreshing ? 'Checking…' : lastCheckedLabel(lastRefreshedAt)}
        </p>
        <Button type="button" variant="fill" size="pill-sm" onClick={() => void refreshQuietly()} disabled={isRefreshing}>
          Check Now
        </Button>
      </div>
    </div>
  )
}

/**
 * The waiting screen's one action, for StepLayout's pinned footer: back to the trip. The
 * step unlocks on its own, so the driver is free to leave and come back.
 */
export function WarehouseWaitAction() {
  const router = useRouter()
  return (
    <Button
      type="button"
      variant="fill"
      size="pill"
      onClick={() => {
        markTransition('back')
        router.push(backTarget(ROUTES.activeTripDetail))
      }}
    >
      View Trip
    </Button>
  )
}

function lastCheckedLabel(lastRefreshedAt: string | null): string {
  if (lastRefreshedAt === null) return ''
  // Absolute local time, not relative: avoids needing a ticking timer to stay honest.
  const time = new Date(lastRefreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Last checked ${time}`
}
