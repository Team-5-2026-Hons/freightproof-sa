// frontend/driver-pwa/components/trip/TripDetailView.tsx
import { CheckCircle2 } from 'lucide-react'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isAnchored } from '@/lib/phase'
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
  // trips/[id] (mock fixture data — no backend trip-history endpoint yet, see its TODO)
  // lists every phase in the plan for context; trips/active (the real, session-derived
  // trip) shows only the single actionable one, per the current-phase-only design. Which
  // data source a page uses decides this, not a UI preference — hence a flag here
  // rather than two independently-maintained views that would drift apart.
  showAllPhases: boolean
}

// Plan order is never trusted off the wire (mirrors lib/phase/derive.ts's own
// bySequence, which is not exported) — every render below walks a freshly-sorted
// copy, never trip.phases as received.
function bySequence(phases: readonly PhaseDescriptor[]): PhaseDescriptor[] {
  return [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
}

// A phase is "done" for display purposes once it's completed OR a dispatcher has
// overridden it — mirrors lib/phase/derive.ts's own RESOLVED_STATUSES, except
// 'exception' is deliberately excluded here: an exception phase still needs its own
// distinct (non-checkmark) treatment in this list, whereas the sequencing walk in
// derive.ts treats it as resolved so the driver isn't stuck on it forever.
function isPhaseDone(phase: PhaseDescriptor): boolean {
  return phase.status === 'completed' || phase.status === 'overridden'
}

// Shared presentational view for both trip-detail screens (Fix 5: they were
// near-identical, hand-duplicated files). Pixel-identical per data source: callers
// supply the trip + navigation callbacks, this component owns none of the data fetching.
export function TripDetailView({
  trip, onBack, onInTransitHub, onSelectPhase, showAllPhases,
}: TripDetailViewProps) {
  const { kind, label } = tripStatusChip(trip.status)
  const phases = bySequence(trip.phases)
  const current = currentPhase(phases)
  // A held trip (a critical exception) must not offer any phase CTA — submits in
  // this state can only 409. Both branches below swap their CTA for HoldNotice.
  const onHold = trip.status === 'exception_hold'
  // The in-transit leg is itself a phase in the plan, not a trip.status value — the
  // coarse five (created | active | closed | cancelled | exception_hold) has no
  // 'in_transit' member. This check naturally re-fires once per leg on a multi-stop
  // plan rather than only ever once.
  const inTransit = current?.phase_type === 'in_transit'

  return (
    // h-dvh + overflow-y-auto (not min-h-screen): this main IS the scrollport, so the
    // screen is exactly one viewport tall and SubpageHeader's sticky sticks against it —
    // the back button stays locked top-left and content passes underneath the glass blur
    // rather than pushing the header off the top. dvh, not vh: 100vh resolves to the
    // address-bar-hidden height in a mobile browser, which made even an empty page
    // taller than the visible viewport and forced a scroll with nothing to scroll to.
    <main className="flex h-dvh flex-col overflow-y-auto overscroll-contain">
      <SubpageHeader
        title={trip.trip_reference}
        backLabel="My Trips"
        onBack={onBack}
        right={<span className="text-xs text-surface-on-variant">{trip.order_number}</span>}
      />

      {/* pb-safe, now that this content sits inside a fixed-height scrollport: without it
          the last card ends flush against the Android gesture bar with no clearance. */}
      {/* px-4/pt-4 rather than p-4: pb-safe sets its own padding-bottom, and the two
          shorthand declarations would otherwise race on one node (same split the step
          screens' `px-6 pt-6 pb-safe` footers already use). */}
      <div className="flex flex-col gap-4 px-4 pt-4 pb-safe">
        {/* Bare chip, not a titled `section` Card. The card spent ~90px of a phone
            screen — a grey panel, a "Status" label and 20px of padding — to say one
            word the chip already says louder and in colour, and it pushed the phase
            timeline (the actual content of this screen) down by a fifth of the
            viewport. Identical treatment to HomeContent, which shows the same trip. */}
        <Chip kind={kind} className="self-start">{label}</Chip>

        <PhaseProgressBar phases={phases} />

        {inTransit && (
          <Button variant="secondary" size="lg" onClick={onInTransitHub}>
            In-Transit Hub →
          </Button>
        )}

        {onHold && <HoldNotice />}

        {showAllPhases ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-surface-on-variant">Phases</h2>
            {/* Only the current phase (docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md,
                unchanged design intent under the phase model) is tappable — a completed
                one is done and re-entering it would resubmit already-anchored evidence;
                a future one hasn't unlocked yet. */}
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
                      {/* Disambiguates a repeated phase type on a cross-dock plan
                          (e.g. the second of three `unloading` rows) — stop_sequence
                          is null only for trip_creation. */}
                      {phase.stop_sequence !== null && (
                        <span className="ml-1.5 text-xs font-normal text-surface-on-variant">
                          Stop {phase.stop_sequence}
                        </span>
                      )}
                    </span>
                    {isCompleted && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />}
                  </div>
                  {/* Only ANCHORED_PHASES are ever anchored — AnchorBadge itself renders
                      nothing when event_hash is null (unanchored phase type, or not yet
                      completed), so this stays clean for every other row without extra
                      branching. */}
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
          // Real active-trip data shows the single actionable phase and nothing else.
          // A per-phase "Evidence anchors" section used to sit here (an AnchorProgress
          // pipeline row per anchored phase); it was removed deliberately — anchoring is
          // a background concern the driver takes no action on, and a read-only list of
          // it pushed the one card that IS actionable off a single-viewport screen.
          // Anchor state remains visible to dispatchers and on the showAllPhases rows.
          !onHold && current !== null && (
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
