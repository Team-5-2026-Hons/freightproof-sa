'use client'

import { useRouter } from 'next/navigation'
import { TopBar }         from '@/components/ui/TopBar'
import { Button }         from '@/components/ui/Button'
import { Ic }             from '@/components/ui/Ic'
import { DashboardExceptionsPanel } from '@/components/dashboard/DashboardExceptionsPanel'
import { DashboardIncidentsPanel } from '@/components/dashboard/DashboardIncidentsPanel'
import { DashboardTripsPanel } from '@/components/dashboard/DashboardTripsPanel'
import { useAuth }        from '@/lib/hooks/useAuth'
import { useNow }         from '@/lib/hooks/useNow'
import { ROUTES }         from '@/lib/constants/routes'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'

// A control-room dashboard can stay open overnight; a minute is fine-grained enough for the date to
// turn over at SAST midnight without a new trip event to re-render it.
const CLOCK_TICK_MS = 60_000
const TRIPS_PANEL_MIN_HEIGHT = 'min-h-[16rem]'

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const now = useNow(CLOCK_TICK_MS)

  // The dispatcher's own organisation, so no operator's dashboard carries another's name. The
  // separator goes with the name while /auth/me has not supplied one.
  const sastDay = fmtSastDateParts(now.toISOString())?.day ?? ''
  const subtitle = user?.organization_name ? `${sastDay} · ${user.organization_name}` : sastDay

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Dispatcher Dashboard"
        badge={user?.role === 'admin_dispatcher' ? (
          <span className="inline-flex items-center gap-[4px] rounded-sm bg-surf-high px-[8px] py-[3px] text-[11px] font-[600] tracking-[0.04em] text-on-surf-v">
            <Ic n="shield" s={11} className="text-on-surf-v shrink-0" />
            Admin
          </span>
        ) : undefined}
        sub={subtitle}
      >
        <Button
          size="sm"
          iconLeft={<Ic n="plus" s={13} className="text-white" />}
          onClick={() => router.push(ROUTES.tripNew)}
        >
          New Trip
        </Button>
      </TopBar>

      {/* Only this area scrolls, so the top bar stays put. On a tall screen nothing scrolls at all. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        {/* No stat strip: fleet figures live on the Analytics page. */}
        {/* Takes the height the two panels below leave, but never less than the minimum, so a short
            screen scrolls the page instead of squeezing the table to nothing. */}
        <div className={`flex flex-1 flex-col ${TRIPS_PANEL_MIN_HEIGHT}`}>
          <DashboardTripsPanel />
        </div>

        {/* Side by side from xl: below that each panel would be too narrow for its columns. */}
        <div className="grid shrink-0 grid-cols-1 gap-6 xl:grid-cols-2">
          <DashboardExceptionsPanel />
          <DashboardIncidentsPanel />
        </div>
      </div>
    </div>
  )
}
