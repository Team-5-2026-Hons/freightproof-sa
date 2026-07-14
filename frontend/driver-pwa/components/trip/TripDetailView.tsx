// frontend/driver-pwa/components/trip/TripDetailView.tsx
import { CheckCircle2 } from 'lucide-react'
import type { Trip } from '@shared/lib/types/trip'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { handshakeProgress, currentHandshakeNumber } from '@/lib/utils/handshake-progress'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
import { CurrentHandshakeCard } from '@/components/trip/CurrentHandshakeCard'
import { AnchorBadge } from '@/components/blockchain/AnchorBadge'

// The only two handshakes the backend anchors to Hedera HCS — see AnchorBadge.
const ANCHORED_HANDSHAKE_NUMBERS = new Set([2, 5])

const HANDSHAKE_NUMBERS = [1, 2, 3, 4, 5] as const

export interface TripDetailViewProps {
  trip: Trip
  onBack: () => void
  onInTransitHub: () => void
  onSelectHandshake: (handshakeNumber: 1 | 2 | 3 | 4 | 5) => void
  // trips/[id] (mock fixture data — no backend trip-history endpoint yet, see its TODO)
  // lists all five handshakes for context; trips/active (the real, session-derived trip)
  // shows only the single actionable one, per the current-handshake-only design. Which
  // data source a page uses decides this, not a UI preference — hence a flag here
  // rather than two independently-maintained views that would drift apart.
  showAllHandshakes: boolean
}

// Shared presentational view for both trip-detail screens (Fix 5: they were
// near-identical, hand-duplicated files). Pixel-identical per data source: callers
// supply the trip + navigation callbacks, this component owns none of the data fetching.
export function TripDetailView({
  trip, onBack, onInTransitHub, onSelectHandshake, showAllHandshakes,
}: TripDetailViewProps) {
  const { kind, label } = tripStatusChip(trip.status)
  const progress = handshakeProgress(trip.handshakes)
  const current = currentHandshakeNumber(progress)

  return (
    <main className="flex min-h-screen flex-col">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="My Trips"
        onBack={onBack}
        right={<span className="text-xs text-surface-on-variant">{trip.order_number}</span>}
      />

      <div className="flex flex-col gap-4 p-4">
        <Card variant="section">
          <p className="mb-2 text-sm font-medium text-surface-on">Status</p>
          <Chip kind={kind}>{label}</Chip>
        </Card>

        <HandshakeProgressBar progress={progress} />

        {trip.status === 'in_transit' && (
          <Button variant="secondary" size="lg" onClick={onInTransitHub}>
            In-Transit Hub →
          </Button>
        )}

        {showAllHandshakes ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
            {/* Only the current handshake (docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md)
                is tappable — a completed one is done and re-entering it would resubmit
                already-anchored evidence; a future one hasn't unlocked yet. */}
            {HANDSHAKE_NUMBERS.map((n) => {
              const isCurrent = n === current
              const isCompleted = progress[n] === 'completed'
              const handshake = trip.handshakes.find((hs) => hs.sequence_number === n)

              return (
                <Card
                  key={n}
                  variant={isCurrent ? 'dark' : isCompleted ? 'default' : 'section'}
                  onClick={isCurrent ? () => onSelectHandshake(n) : undefined}
                  className={!isCurrent && !isCompleted ? 'opacity-50' : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
                    </span>
                    {isCompleted && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />}
                  </div>
                  {/* Only H2/H5 are ever anchored — AnchorBadge itself renders nothing
                      when event_hash is null (feeder handshake or not yet completed),
                      so this stays clean for every other row without extra branching. */}
                  {ANCHORED_HANDSHAKE_NUMBERS.has(n) && (
                    <AnchorBadge
                      eventHash={handshake?.event_hash ?? null}
                      receiptId={handshake?.blockchain_receipt_id ?? null}
                      className="mt-2"
                    />
                  )}
                </Card>
              )
            })}
          </section>
        ) : (
          current !== null && (
            <CurrentHandshakeCard
              handshakeNumber={current}
              onSelect={() => onSelectHandshake(current)}
            />
          )
        )}
      </div>
    </main>
  )
}
