'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, MessageSquare, CheckCircle2, Navigation } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { EvidencePacket } from '@/components/domain/EvidencePacket'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { useToast } from '@/lib/hooks/useToast'
import { useExceptions } from '@/lib/hooks/useExceptions'
import { mockTrips } from '@shared/lib/mocks/trips'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import { COPY } from '@shared/lib/constants/copy'
import { ROUTES } from '@/lib/constants/routes'

export default function ExceptionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { notify } = useToast()
  
  const exceptionId = params.id as string
  // For the MVP, we just find it from the mock data hook
  const allExceptions = useExceptions()
  const exception = useMemo(() => allExceptions.find(e => e.id === exceptionId), [allExceptions, exceptionId])
  
  const [resolutionNote, setResolutionNote] = useState('')
  const [resolving, setResolving] = useState(false)

  if (!exception) {
    return (
      <PageShell>
        <EmptyState
          icon={<MessageSquare />}
          title="Exception not found"
          body="This record does not exist or you do not have access to it."
          cta={<Button onClick={() => router.push(ROUTES.exceptions)}>Back to Feed</Button>}
        />
      </PageShell>
    )
  }

  const trip = mockTrips.find(t => t.id === exception.trip_id)
  const sevMeta = EXCEPTION_SEVERITY_META[exception.severity]

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resolutionNote) return

    setResolving(true)
    await new Promise(r => setTimeout(r, 600))
    
    notify({
      kind: 'success',
      title: COPY.toast.exceptionResolved,
    })
    
    // In MVP, we just navigate back to the feed since we can't mutate the mock data
    router.push(ROUTES.exceptions)
  }

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        title="Exception Detail"
        breadcrumbs={[
          { label: 'Exceptions', href: ROUTES.exceptions },
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

      {trip && (
        <Card variant="section" className="mb-6 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant mb-1">Related Trip</p>
            <TripIdStamp tripReference={trip.trip_reference} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconRight={<Navigation className="w-4 h-4" />}
            onClick={() => router.push(ROUTES.tripDetail(trip.id))}
          >
            View Trip
          </Button>
        </Card>
      )}

      <EvidencePacket
        chipKind={sevMeta.chipKind}
        chipLabel={sevMeta.label}
        title={exception.exception_type.replace(/_/g, ' ')}
        exception={!exception.resolved}
        className="mb-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-surface-on-variant w-24">Source</span>
          <span className="text-sm text-surface-on font-medium capitalize">{exception.source}</span>
        </div>
        
        <div className="p-4 bg-surface-container-low rounded-xl mb-4">
          <p className="text-sm text-surface-on leading-relaxed">
            {exception.description}
          </p>
        </div>

        <div className="flex items-center justify-between mt-4">
          <TimestampWithIcon timestamp={exception.created_at} />
          <Chip kind={exception.resolved ? 'success' : 'error'}>
            {exception.resolved ? 'Resolved' : 'Open'}
          </Chip>
        </div>
      </EvidencePacket>

      {/* Resolution section */}
      {exception.resolved ? (
        <Card variant="section" className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <h3 className="text-lg font-bold text-surface-on">Resolution</h3>
          </div>
          <p className="text-sm text-surface-on-variant mb-4">{exception.resolver_note}</p>
          <TimestampWithIcon timestamp={exception.resolved_at!} />
        </Card>
      ) : (
        <Card className="p-5 border border-secondary/20">
          <h3 className="text-lg font-bold text-surface-on mb-4">Resolve Exception</h3>
          <form onSubmit={handleResolve} className="space-y-4">
            <Input
              label="Resolution Note"
              placeholder={COPY.confirm.resolveNote}
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!resolutionNote || resolving}
                loading={resolving}
              >
                {COPY.actions.resolve}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PageShell>
  )
}
