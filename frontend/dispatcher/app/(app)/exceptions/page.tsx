'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ShieldAlert, CheckCircle2, Navigation } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { useExceptions } from '@/lib/hooks/useExceptions'
import { mockTrips } from '@shared/lib/mocks/trips'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import { COPY } from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'

export default function ExceptionsPage() {
  const router = useRouter()
  // Active/resolved toggle
  const [showResolved, setShowResolved] = useState(false)
  const exceptions = useExceptions({ resolved: showResolved })

  return (
    <PageShell>
      <PageHeader title="Exceptions Feed" />

      {/* Toggle filter */}
      <div className="flex gap-2 mb-6 border-b border-outline-variant/20 pb-4">
        <button
          onClick={() => setShowResolved(false)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors',
            !showResolved ? 'bg-secondary/10 text-secondary' : 'text-surface-on-variant hover:bg-surface-container-low'
          )}
        >
          Open Issues
        </button>
        <button
          onClick={() => setShowResolved(true)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors',
            showResolved ? 'bg-secondary/10 text-secondary' : 'text-surface-on-variant hover:bg-surface-container-low'
          )}
        >
          Resolved
        </button>
      </div>

      {exceptions.length === 0 ? (
        <EmptyState
          icon={showResolved ? <CheckCircle2 /> : <ShieldAlert />}
          title={showResolved ? 'No resolved exceptions' : COPY.emptyState.allClear.title}
          body={showResolved ? 'No exceptions have been resolved yet.' : COPY.emptyState.allClear.body}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {exceptions.map(exc => {
            const sevMeta = EXCEPTION_SEVERITY_META[exc.severity]
            const trip = mockTrips.find(t => t.id === exc.trip_id)

            return (
              <Card
                key={exc.id}
                variant={exc.resolved ? 'default' : 'exception'}
                onClick={() => router.push(ROUTES.exceptionDetail(exc.id))}
                className="flex flex-col h-full"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Chip kind={sevMeta.chipKind}>{sevMeta.label}</Chip>
                    <Chip kind="neutral">{exc.exception_type.replace(/_/g, ' ')}</Chip>
                  </div>
                  {trip && <TripIdStamp tripReference={trip.trip_reference} />}
                </div>

                <div className="flex-1 mb-4">
                  <p className="text-sm text-surface-on leading-relaxed line-clamp-3">
                    {exc.description}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 mt-auto pt-4 border-t border-outline-variant/20">
                  <TimestampWithIcon timestamp={exc.created_at} />
                  <Button variant="ghost" size="sm" iconRight={<Navigation className="w-4 h-4" />}>
                    View
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
