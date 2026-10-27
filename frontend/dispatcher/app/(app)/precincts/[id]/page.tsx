'use client'

import React, { useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { MapPinOff } from 'lucide-react'

import { TopBar } from '@/components/ui/TopBar'
import { BackButton } from '@/components/ui/BackButton'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs, type Tab } from '@/components/ui/Tabs'
import { InfoRow } from '@/components/ui/InfoRow'
import { AdminOnly } from '@/components/auth/AdminOnly'
import { ResizableHeight } from '@/components/ui/ResizableHeight'
import { GeofenceMap } from '@/components/map/GeofenceMap'
import { PrecinctDetailSkeleton } from '@/components/precincts/PrecinctDetailSkeleton'
import { EventTimeline } from '@/components/blockchain/EventTimeline'
import { PrecinctAnalyticsSummary } from '@/components/analytics/PrecinctAnalyticsSummary'
import { useAuth } from '@/lib/hooks/useAuth'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'
import { ROUTES } from '@/lib/constants/routes'
import { RETURN_TO_PARAM, safeReturnTo } from '@/lib/navigation/returnTo'
import { describeGeofence } from '@/lib/map/polygon'

const COORDINATE_PRECISION = 5

const LOWER_PANEL_TABS = [
  { id: 'history', label: 'Change History' },
  { id: 'analytics', label: 'Analytics' },
] as const satisfies readonly Tab[]

type LowerPanelTabId = (typeof LOWER_PANEL_TABS)[number]['id']

const LOWER_PANEL_ID = 'precinct-lower-panel'
const MAP_HEIGHT = { initial: 320, min: 240, max: 800 } as const

export default function PrecinctDetailPage(): React.JSX.Element {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const backTo = safeReturnTo(search.get(RETURN_TO_PARAM), ROUTES.precincts)
  const { precinct, isLoading, error, refetch } = usePrecinctDetail(params.id)
  const { user } = useAuth()
  const [lowerTab, setLowerTab] = useState<LowerPanelTabId>('history')

  const backButton = <BackButton onClick={() => router.push(backTo)} />

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Precinct" left={backButton} />
        <PrecinctDetailSkeleton />
      </div>
    )
  }

  if (error !== null || precinct === null) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Precinct unavailable" left={backButton} />
        <div className="flex items-center justify-center flex-1">
          <EmptyState
            icon={<MapPinOff />}
            title="Precinct unavailable"
            body={
              error ??
              'This precinct could not be loaded. It may not exist, or it may belong to another organisation.'
            }
            cta={
              <Button size="sm" variant="ghost" onClick={refetch}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const isOwner =
    String(precinct.principal_organization_id) === String(user?.organization_id)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={precinct.name} left={backButton}>
        {isOwner && (
          <AdminOnly>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(ROUTES.precinctEdit(String(precinct.id)))}
            >
              Edit
            </Button>
          </AdminOnly>
        )}
      </TopBar>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col lg:overflow-y-auto">
          <div className="p-6 pb-0">
            <ResizableHeight
              initialHeight={MAP_HEIGHT.initial}
              minHeight={MAP_HEIGHT.min}
              maxHeight={MAP_HEIGHT.max}
              label="Resize map"
              className="w-full"
            >
              <GeofenceMap
                latitude={precinct.latitude}
                longitude={precinct.longitude}
                radiusMetres={precinct.geofence_radius_metres}
                polygon={precinct.geofence_polygon}
                className="w-full h-full"
              />
            </ResizableHeight>
          </div>

          <div className="p-6">
            <Tabs
              tabs={LOWER_PANEL_TABS}
              active={lowerTab}
              onChange={(id) => setLowerTab(id === 'analytics' ? 'analytics' : 'history')}
              panelId={LOWER_PANEL_ID}
              ariaLabel="Precinct history or analytics"
              className="mb-4"
            />
            <div id={LOWER_PANEL_ID} role="tabpanel" aria-labelledby={`tab-${lowerTab}`} tabIndex={0}>
              {lowerTab === 'history' ? (
                <>
                  <EventTimeline events={precinct.events} receipts={precinct.receipts} />
                  {precinct.receipts.length === 0 && precinct.events.length > 0 && (
                    <p className="text-[11px] text-on-surf-v mt-3">
                      Anchoring records are shown to administrators of the owning organisation.
                    </p>
                  )}
                </>
              ) : (
                <div className="bg-surf-lowest rounded-lg shadow-level-2 p-5">
                  <PrecinctAnalyticsSummary precinctId={precinct.id} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="w-full lg:w-[256px] shrink-0 bg-surf-low p-5 flex flex-col gap-4 border-l border-outline-v/30">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Precinct
            </span>
            <InfoRow label="Address" value={precinct.address ?? '—'} />
            <InfoRow label="Latitude" value={precinct.latitude.toFixed(COORDINATE_PRECISION)} mono />
            <InfoRow label="Longitude" value={precinct.longitude.toFixed(COORDINATE_PRECISION)} mono />
            <InfoRow label="Geofence" value={describeGeofence(precinct)} mono />
            <InfoRow label="Shared" value={precinct.is_shared ? 'Yes' : 'No'} />
            {!isOwner && (
              <p className="text-[11px] text-on-surf-v">
                Shared with your organisation by its owner. You can plan trips to it but
                not change it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
