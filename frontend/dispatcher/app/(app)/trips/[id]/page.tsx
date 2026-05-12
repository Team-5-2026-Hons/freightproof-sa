'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Clock, List, AlertTriangle, Link2, Package } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { HandshakeChain } from '@/components/domain/HandshakeChain'
import { ExceptionBanner } from '@/components/domain/ExceptionBanner'
import { EvidencePacket } from '@/components/domain/EvidencePacket'
import { BlockchainReceipt } from '@/components/domain/BlockchainReceipt'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { Chip } from '@/components/ui/Chip'
import { Tabs } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_STATUS_META, HANDSHAKE_STATUS_META, EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { mockManifests } from '@shared/lib/mocks/manifests'
import type { HandshakeNumber } from '@shared/lib/types/handshake'

const TABS = [
  { id: 'timeline', label: 'Timeline', icon: <Clock className="w-4 h-4" /> },
  { id: 'manifest', label: 'Manifest', icon: <Package className="w-4 h-4" /> },
  { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle className="w-4 h-4" /> },
  { id: 'blockchain', label: 'Blockchain', icon: <Link2 className="w-4 h-4" /> },
]

export default function TripDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('timeline')

  const tripId = params.id as string
  const trip = useMemo(() => mockTrips.find(t => t.id === tripId), [tripId])

  if (!trip) {
    return (
      <PageShell>
        <EmptyState
          icon={<AlertTriangle />}
          title="Trip not found"
          body="This trip does not exist or you do not have access to it."
          cta={<Button onClick={() => router.push(ROUTES.home)}>Back to Active Trips</Button>}
        />
      </PageShell>
    )
  }

  const statusMeta = TRIP_STATUS_META[trip.status]
  const originPrecinct = mockPrecincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct = mockPrecincts.find(p => p.id === trip.destination_precinct_id)
  const openExceptions = trip.exceptions.filter(e => !e.resolved)
  const isClosed = trip.status === 'closed'
  const manifest = mockManifests.find(m => m.trip_id === trip.id)

  return (
    <PageShell>
      {/* Back button + breadcrumb */}
      <PageHeader
        title={trip.trip_reference}
        badge={<Chip kind={statusMeta.chipKind}>{statusMeta.label}</Chip>}
        breadcrumbs={[
          { label: 'Active Trips', href: ROUTES.home },
        ]}
        actions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<ArrowLeft className="w-4 h-4" />}
            onClick={() => router.back()}
          >
            Back
          </Button>
        }
      />

      {/* Closed trip banner */}
      {isClosed && (
        <Card variant="section" className="mb-4 p-3 flex items-center gap-2">
          <Chip kind="success">Closed</Chip>
          <span className="text-sm text-surface-on-variant">This trip is complete and read-only.</span>
        </Card>
      )}

      {/* Active exception banner */}
      {openExceptions.length > 0 && !isClosed && (
        <div className="mb-4">
          <ExceptionBanner
            title={`${openExceptions.length} open exception${openExceptions.length > 1 ? 's' : ''}`}
            description={openExceptions[0].description}
            action={
              <Button
                variant="danger"
                size="sm"
                onClick={() => router.push(ROUTES.exceptionDetail(openExceptions[0].id))}
              >
                View
              </Button>
            }
          />
        </div>
      )}

      {/* Full handshake chain */}
      <Card className="mb-6 p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-surface-on-variant mb-3">Evidence Chain</h2>
        <HandshakeChain handshakes={trip.handshakes} />
      </Card>

      {/* Trip info summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card variant="section" className="p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Driver</p>
          <p className="text-sm font-bold text-surface-on mt-1">{trip.driver?.full_name ?? '—'}</p>
        </Card>
        <Card variant="section" className="p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Horse</p>
          <p className="text-sm font-bold text-surface-on mt-1">{trip.horse?.registration ?? '—'}</p>
        </Card>
        <Card variant="section" className="p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Origin</p>
          <p className="text-sm font-bold text-surface-on mt-1">{originPrecinct?.name.split('—')[0]?.trim() ?? '—'}</p>
        </Card>
        <Card variant="section" className="p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Destination</p>
          <p className="text-sm font-bold text-surface-on mt-1">{destPrecinct?.name.split('—')[0]?.trim() ?? '—'}</p>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} className="mb-6" />

      {/* Tab content */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {trip.handshakes
            .filter(hs => hs.status !== 'pending')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map(hs => {
              const hsMeta = HANDSHAKE_STATUS_META[hs.status]
              const hsName = HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]
              return (
                <EvidencePacket
                  key={hs.id}
                  chipKind={hsMeta.chipKind}
                  chipLabel={hsMeta.label}
                  title={hsName}
                  exception={hs.status === 'exception'}
                >
                  {hs.completed_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Completed</span>
                      <TimestampWithIcon timestamp={hs.completed_at} />
                    </div>
                  )}
                  {hs.seal_number && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Seal</span>
                      <span className="font-mono tracking-[0.05em] font-bold text-sm text-surface-on">{hs.seal_number}</span>
                    </div>
                  )}
                  {hs.parcel_count_origin !== null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Parcels</span>
                      <span className="text-sm text-surface-on font-medium">{hs.parcel_count_origin} loaded</span>
                    </div>
                  )}
                  {hs.pulsit_geofence_confirmed !== null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Geofence</span>
                      <Chip kind={hs.pulsit_geofence_confirmed ? 'success' : 'error'}>
                        {hs.pulsit_geofence_confirmed ? 'Confirmed' : 'Mismatch'}
                      </Chip>
                    </div>
                  )}
                  {hs.event_hash && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Hash</span>
                      <span className="font-mono tracking-[0.05em] text-xs text-surface-on-variant truncate">
                        {hs.event_hash.slice(0, 16)}…
                      </span>
                    </div>
                  )}
                </EvidencePacket>
              )
            })}
          {trip.handshakes.filter(hs => hs.status !== 'pending').length === 0 && (
            <EmptyState
              icon={<Clock />}
              title="No events yet"
              body="This trip has no completed handshake events."
            />
          )}
        </div>
      )}

      {activeTab === 'manifest' && (
        <div className="space-y-4">
          {manifest ? (
            manifest.stops.map((stop, i) => (
              <EvidencePacket
                key={i}
                chipKind="info"
                chipLabel={`Stop ${i + 1}`}
                title={stop.delivery_stop}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Parcels</span>
                  <span className="text-sm text-surface-on font-medium">{stop.parcel_count} items</span>
                </div>
                {stop.parcels.map((parcel) => (
                  <div key={parcel.id} className="flex items-center gap-2 text-xs text-surface-on-variant">
                    <span className="font-mono tracking-[0.05em] font-bold">{parcel.barcode}</span>
                    {parcel.description && <span>· {parcel.description}</span>}
                  </div>
                ))}
              </EvidencePacket>
            ))
          ) : (
            <EmptyState
              icon={<Package />}
              title="No manifest"
              body="No manifest has been loaded for this trip yet."
            />
          )}
        </div>
      )}

      {activeTab === 'exceptions' && (
        <div className="space-y-4">
          {trip.exceptions.length > 0 ? (
            trip.exceptions.map(exc => {
              const sevMeta = EXCEPTION_SEVERITY_META[exc.severity]
              return (
                <EvidencePacket
                  key={exc.id}
                  chipKind={sevMeta.chipKind}
                  chipLabel={exc.exception_type.replace(/_/g, ' ')}
                  title={exc.description}
                  exception={!exc.resolved}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Source</span>
                    <span className="text-sm text-surface-on font-medium capitalize">{exc.source}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Status</span>
                    <Chip kind={exc.resolved ? 'success' : 'error'}>
                      {exc.resolved ? 'Resolved' : 'Open'}
                    </Chip>
                  </div>
                  {exc.resolver_note && (
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24 shrink-0">Note</span>
                      <span className="text-sm text-surface-on">{exc.resolver_note}</span>
                    </div>
                  )}
                  <TimestampWithIcon timestamp={exc.created_at} />
                </EvidencePacket>
              )
            })
          ) : (
            <EmptyState
              icon={<AlertTriangle />}
              title="No exceptions"
              body="This trip has no logged exceptions."
            />
          )}
        </div>
      )}

      {activeTab === 'blockchain' && (
        <div className="space-y-4">
          {trip.blockchain_receipts.length > 0 ? (
            trip.blockchain_receipts.map(receipt => (
              <BlockchainReceipt key={receipt.id} receipt={receipt} />
            ))
          ) : (
            <EmptyState
              icon={<Link2 />}
              title="No blockchain receipts"
              body="No events have been anchored to the blockchain for this trip yet."
            />
          )}
        </div>
      )}
    </PageShell>
  )
}
