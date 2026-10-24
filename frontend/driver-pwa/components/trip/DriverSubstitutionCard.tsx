'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Phone } from 'lucide-react'
import type {
  DriverSubstitutionContextRead,
  SubstitutionRequestRead,
  SubstitutionRole,
} from '@shared/lib/types/driver-substitution'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { fetchDriverSubstitutionContext } from '@/lib/api/driver-substitutions'
import { coordinateDirectionsUrl } from '@/lib/utils/directions'
import {
  blockerMessage,
  counterpartOf,
  hasConfirmed,
  identityLabel,
  substitutionStatusLine,
} from '@/lib/utils/driver-substitution'
import { ROUTES } from '@/lib/constants/routes'
import { formatDateTime } from '@/lib/utils/format-time'
import { formatPhoneForDisplay } from '@/lib/utils/format-phone'
import { knownPrecinctName } from '@/lib/utils/precinct-name'
import { Button } from '@/components/ui/Button'
import { StatusBanner, type StatusTone } from '@/components/ui/StatusBanner'

export interface DriverSubstitutionCardProps {
  request: SubstitutionRequestRead
  role: SubstitutionRole
  /**
   * Already-loaded collection context. A cancelled notice passes the snapshot it fetched;
   * a pending card leaves this out and loads it on demand, so the list poll stays light.
   */
  context?: DriverSubstitutionContextRead
}

function statusTone(request: SubstitutionRequestRead): StatusTone {
  if (request.state === 'completed') return 'success'
  if (request.state === 'cancelled' || request.completion_blocked_by !== null) return 'attention'
  return 'neutral'
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-footnote text-surface-on-variant">{label}</dt>
      <dd className="text-body text-surface-on">{children}</dd>
    </div>
  )
}

function CollectionDetails({ context }: { context: DriverSubstitutionContextRead }) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      {context.current_phase !== null && (
        <p className="text-subhead text-surface-on">Trip is at: {PHASE_NAMES[context.current_phase]}</p>
      )}
      <section aria-label="Remaining stops">
        <p className="text-footnote text-surface-on-variant">Remaining stops</p>
        {context.remaining_stops.length === 0 ? (
          <p className="text-subhead text-surface-on">No stops left after the exchange</p>
        ) : (
          <ol className="list-decimal pl-5 text-subhead text-surface-on">
            {context.remaining_stops.map((stop, index) => (
              // Labelled by position when the precinct is not in the local lookup —
              // never an id fragment the driver cannot act on.
              <li key={stop.id}>{knownPrecinctName(stop.precinct_id) ?? `Stop ${index + 1}`}</li>
            ))}
          </ol>
        )}
      </section>
      {context.findings.length > 0 && (
        <section aria-label="Current findings">
          <p className="text-footnote text-surface-on-variant">Recorded on this trip</p>
          <ul className="flex flex-col gap-1 text-subhead text-surface-on">
            {context.findings.map((finding) => <li key={finding.id}>{finding.description}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

/**
 * One driver-handover arrangement as the server states it: where and when, who the
 * other driver is, which vehicles change hands, and what is still outstanding. It offers no
 * confirm control — recording the handover is its own evidence flow (T2) — and it never
 * presents a pending arrangement as a completed custody change.
 */
export function DriverSubstitutionCard({ request, role, context: preloaded }: DriverSubstitutionCardProps) {
  const [context, setContext] = useState<DriverSubstitutionContextRead | null>(preloaded ?? null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const counterpart = counterpartOf(request, role)
  const isPending = request.state === 'pending'
  const blocker = request.completion_blocked_by
  // The server's permitted actions decide whether a check can be recorded now (T2); the
  // card only links to the driver's own capture screen, it never confirms anything itself.
  const canRecord = isPending
    && request.permitted_actions.includes(role === 'outgoing' ? 'confirm_outgoing' : 'confirm_incoming')
  const alreadyRecorded = hasConfirmed(request, role)

  const toggleDetails = async () => {
    if (detailsOpen) { setDetailsOpen(false); return }
    setDetailsOpen(true)
    if (context !== null) return
    setDetailsLoading(true)
    setDetailsError(null)
    try {
      setContext(await fetchDriverSubstitutionContext(request.trip_id, request.id))
    } catch (err: unknown) {
      console.error('Could not load the handover context', err)
      setDetailsError('Could not load the trip details. Check your connection and try again.')
    } finally {
      setDetailsLoading(false)
    }
  }

  return (
    <section
      aria-label={`Driver handover ${request.trip_reference}`}
      className="rounded-[22px] bg-fill px-4 pb-4 pt-4"
    >
      <p className="text-footnote font-semibold uppercase tracking-wide text-surface-on-variant">
        {role === 'incoming' ? 'Collect this trip' : request.request_format === 'immediate_v2' ? 'Transfer notification' : 'Hand over this trip'}
      </p>
      <p className="text-title-2 text-surface-on">{request.trip_reference}</p>

      <StatusBanner tone={statusTone(request)} title={substitutionStatusLine(request, role)} className="mt-3 bg-surface">
        {blocker !== null && isPending ? `${request.request_format === 'immediate_v2' && role === 'outgoing' ? "Incoming acceptance is saved." : "Your check is saved."} ${blockerMessage(blocker)}` : undefined}
      </StatusBanner>

      {request.request_format === 'immediate_v2' && role === 'outgoing' && <p className="mt-2 text-subhead">Not requested (notification only). You do not need to confirm or record a location.</p>}
      <dl className="mt-2 divide-y divide-hairline">
        {request.exchange && <Fact label="Exchange point">
          <span className="block">{request.exchange.label}</span>
          {request.exchange.instructions !== '' && (
            <span className="block text-subhead text-surface-on-variant">{request.exchange.instructions}</span>
          )}
          <a
            href={coordinateDirectionsUrl(request.exchange.latitude, request.exchange.longitude)}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-subhead font-semibold text-surface-on underline"
          >
            <MapPin aria-hidden className="size-4" strokeWidth={2} />
            Directions
          </a>
        </Fact>}
        {request.expected_at && <Fact label="Expected">{formatDateTime(request.expected_at)}</Fact>}
        <Fact label={role === 'incoming' ? 'Handing over' : 'Taking over'}>
          <span className="block">{counterpart.full_name}</span>
          <a
            href={`tel:${counterpart.phone_number}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-subhead font-semibold text-surface-on underline"
          >
            <Phone aria-hidden className="size-4" strokeWidth={2} />
            {formatPhoneForDisplay(counterpart.phone_number)}
          </a>
        </Fact>
        <Fact label="Vehicles">
          {request.vehicles.length === 0
            ? 'No vehicles listed'
            : request.vehicles.map((vehicle) => vehicle.registration).join(' · ')}
        </Fact>
        <Fact label="Incoming driver identity">{identityLabel(request.identity.status)}</Fact>
      </dl>

      {isPending && (canRecord || alreadyRecorded) && (
        <Button asChild variant={alreadyRecorded ? 'secondary' : 'primary'} size="sm" className="mt-3 w-full">
          <Link href={ROUTES.substitution(request.trip_id, request.id)}>
            {alreadyRecorded
              ? 'View your check'
              : role === 'outgoing' ? 'Record your handover check' : 'Record your takeover check'}
          </Link>
        </Button>
      )}

      {/* Live collection context only while the arrangement is pending: a cancelled or
          replaced snapshot must not lead the driver into the trip's later progress. */}
      {isPending && (
        <>
          <Button variant="secondary" size="sm" className="mt-2" aria-expanded={detailsOpen} onClick={() => void toggleDetails()}>
            {detailsOpen ? 'Hide trip details' : 'Trip details'}
          </Button>
          {detailsOpen && detailsLoading && <p className="mt-2 text-subhead text-surface-on-variant">Loading trip details…</p>}
          {detailsOpen && detailsError !== null && <p className="mt-2 text-subhead text-error">{detailsError}</p>}
          {detailsOpen && context !== null && <CollectionDetails context={context} />}
        </>
      )}
    </section>
  )
}
