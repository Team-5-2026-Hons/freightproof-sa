import type { ReactNode } from 'react'
import { CheckCircle2, Truck } from 'lucide-react'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isAnchored, isDriving } from '@/lib/phase'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { SubpageHeader } from '@/components/layout/SubpageHeader'
import { PhaseProgressBar } from '@/components/trip/PhaseProgressBar'
import { CurrentPhaseCard } from '@/components/trip/CurrentPhaseCard'
import { HoldNotice } from '@/components/trip/HoldNotice'
import { AnchorBadge } from '@/components/blockchain/AnchorBadge'

export interface TripDetailViewProps {
  trip: Trip
  onBack: () => void
  onInTransitHub: () => void
  onSelectPhase: (phase: PhaseDescriptor) => void
  // trips/[id] (mock data) lists every phase for context; trips/active shows only the
  // single actionable one, per the current-phase-only design.
  showAllPhases: boolean
  // Page-level banner rendered inside this component's scrollport, not above it. The
  // trip-detail routes are full-bleed (no AppShell), so a caller-rendered sibling above
  // <main> would paint under the status bar and push an exact-viewport screen off the bottom.
  notice?: ReactNode
}

// Plan order is never trusted off the wire — every render below walks a freshly-sorted copy.
function bySequence(phases: readonly PhaseDescriptor[]): PhaseDescriptor[] {
  return [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
}

// 'exception' is deliberately excluded (unlike derive.ts's RESOLVED_STATUSES): it still
// needs its own distinct, non-checkmark treatment in this list.
function isPhaseDone(phase: PhaseDescriptor): boolean {
  return phase.status === 'completed' || phase.status === 'overridden'
}

// Shared presentational view for both trip-detail screens: callers supply the trip +
// navigation callbacks, this component owns none of the data fetching.
export function TripDetailView({
  trip, onBack, onInTransitHub, onSelectPhase, showAllPhases, notice,
}: TripDetailViewProps) {
  const { kind, label } = tripStatusChip(trip.status)
  const phases = bySequence(trip.phases)
  const current = currentPhase(phases)
  // A held trip must not offer any phase CTA — submits in this state can only 409.
  const onHold = trip.status === 'exception_hold'
  // True only while the ledger's current row is an unresolved in_transit.
  const driving = isDriving(phases)

  return (
    // h-dvh + overflow-y-auto: this main IS the scrollport, so SubpageHeader's sticky
    // sticks against it. dvh, not vh, since 100vh resolves to the address-bar-hidden height.
    <main className="flex h-dvh flex-col overflow-y-auto overscroll-contain">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="My Trips"
        onBack={onBack}
        titleVariant="reference"
        titleCaption="Trip reference"
        right={
          <span className="shrink-0 rounded-xl border-2 border-primary px-3 py-1.5 text-xs font-bold tracking-industrial text-surface-on">
            {trip.order_number}
          </span>
        }
      />

      <div className="flex flex-col gap-4 px-4 pt-4 pb-safe">
        {notice}

        <Chip kind={kind} className="self-start">{label}</Chip>

        <PhaseProgressBar phases={phases} />

        {/* Primary action while driving; a held trip outranks it and shows HoldNotice instead. */}
        {driving && !onHold && (
          <Button
            size="lg"
            iconLeft={<Truck className="h-5 w-5" strokeWidth={2} aria-hidden />}
            onClick={onInTransitHub}
          >
            Continue driving
          </Button>
        )}

        {onHold && <HoldNotice />}

        {showAllPhases ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-surface-on-variant">Phases</h2>
            {/* Only the current phase is tappable: completed would resubmit anchored
                evidence, future hasn't unlocked yet. */}
            {phases.map((phase) => {
              const isCurrent = phase.phase_event_id === current?.phase_event_id
              const isCompleted = isPhaseDone(phase)

              return (
                <Card
                  key={phase.phase_event_id}
                  variant={isCurrent ? 'dark' : isCompleted ? 'default' : 'section'}
                  onClick={isCurrent && !onHold ? () => onSelectPhase(phase) : undefined}
                  className={!isCurrent && !isCompleted ? 'opacity-50' : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold">{PHASE_NAMES[phase.phase_type]}</span>
                      {/* Disambiguates a repeated phase type on a cross-dock plan. */}
                      {phase.stop_sequence !== null && (
                        <span className="ml-1.5 text-xs font-normal text-surface-on-variant">
                          Stop {phase.stop_sequence}
                        </span>
                      )}
                    </span>
                    {isCompleted && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />}
                  </div>
                  {isAnchored(phase) && (
                    <AnchorBadge
                      eventHash={phase.event_hash}
                      receiptId={phase.blockchain_receipt_id}
                      className="mt-2"
                    />
                  )}
                </Card>
              )
            })}
          </section>
        ) : (
          // Suppressed while driving: the current phase is then the arrival phase, whose
          // steps can't be completed until the truck has arrived. "Continue driving"
          // above takes its place.
          !onHold && !driving && current !== null && (
            <CurrentPhaseCard
              phase={current}
              onSelect={() => onSelectPhase(current)}
            />
          )
        )}
      </div>
    </main>
  )
}
