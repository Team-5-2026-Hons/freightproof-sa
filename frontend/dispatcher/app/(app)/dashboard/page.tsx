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

const CLOCK_TICK_MS = 60_000
const TRIPS_PANEL_MIN_HEIGHT = 'min-h-[16rem]'

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const now = useNow(CLOCK_TICK_MS)

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

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <div className={`flex flex-1 flex-col ${TRIPS_PANEL_MIN_HEIGHT}`}>
          <DashboardTripsPanel />
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-6 xl:grid-cols-2">
          <DashboardExceptionsPanel />
          <DashboardIncidentsPanel />
        </div>
      </div>
    </div>
  )
}
