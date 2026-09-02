'use client'

import React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { MapPinOff } from 'lucide-react'

import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { SecHead } from '@/components/ui/SecHead'
import { InfoRow } from '@/components/ui/InfoRow'
import { Ic } from '@/components/ui/Ic'
import { AdminOnly } from '@/components/auth/AdminOnly'
import { GeofenceMap } from '@/components/map/GeofenceMap'
import { EventTimeline } from '@/components/blockchain/EventTimeline'
import { useAuth } from '@/lib/hooks/useAuth'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'
import { ROUTES } from '@/lib/constants/routes'

// 5 dp ≈ 1 m. Coordinates are identifiers here, not measurements — they are read to be
// compared against a maps app, so they render at a fixed precision.
const COORDINATE_PRECISION = 5

export default function PrecinctDetailPage(): React.JSX.Element {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { precinct, isLoading, error, refetch } = usePrecinctDetail(params.id)
  const { user } = useAuth()

  // Present in every state (loading/error/success), same as the vehicle detail page —
  // a header that only appears once data resolves reads as broken chrome, and without
  // it there is no way back to the list except the browser's own back button.
  const backButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => router.push(ROUTES.precincts)}
      iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
    >
      Back
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Precinct" left={backButton} />
        <div className="flex items-center justify-center flex-1">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error !== null || precinct === null) {
    // The hook collapses every failure to a message string, so a 404 (this precinct is
    // not yours to see) is indistinguishable here from a network failure. The copy
    // deliberately does not claim which it was.
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

  // A precinct listed via is_shared is owned by another org: the API answers 404 on a
  // write. Hiding Edit is not the security control — the server is — but offering a
  // button that can only fail is worse than not offering it.
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
            {/* No onPositionChange: a detail view reads the geofence, it does not move it. */}
            <GeofenceMap
              latitude={precinct.latitude}
              longitude={precinct.longitude}
              radiusMetres={precinct.geofence_radius_metres}
              className="w-full h-[320px]"
            />
          </div>

          <div className="p-6">
            <SecHead title="Change history" />
            {/* The point of the ledger: a rename appears here with no anchor badge, a
                geofence change with one. DESIGN_SYSTEM 10.3 — the absence is the information. */}
            <EventTimeline events={precinct.events} receipts={precinct.receipts} />
            {precinct.receipts.length === 0 && precinct.events.length > 0 && (
              // Receipts are withheld from non-admins and for precincts visible only via
              // is_shared, so an empty list is not evidence that nothing was anchored.
              <p className="text-[11px] text-on-surf-v mt-3">
                Anchoring records are shown to administrators of the owning organisation.
              </p>
            )}
          </div>
        </div>

        <div className="w-full lg:w-[256px] shrink-0 bg-surf-low p-5 flex flex-col gap-4 border-l border-outline-v/30">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Precinct
            </span>
            <InfoRow label="Address" value={precinct.address ?? '—'} />
            {/* mono is InfoRow's tabular-nums treatment — required for identifiers by
                DESIGN_SYSTEM 5.2 / 10.4. */}
            <InfoRow label="Latitude" value={precinct.latitude.toFixed(COORDINATE_PRECISION)} mono />
            <InfoRow label="Longitude" value={precinct.longitude.toFixed(COORDINATE_PRECISION)} mono />
            <InfoRow label="Geofence" value={`${precinct.geofence_radius_metres} m`} mono />
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
