'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Spinner }    from '@/components/ui/Spinner'
import { Ic }         from '@/components/ui/Ic'
import { EmptyState } from '@/components/ui/EmptyState'
import { InfoRow }    from '@/components/ui/InfoRow'
import { ROUTES }     from '@/lib/constants/routes'
import { useTripDetail }  from '@/lib/hooks/useTripDetail'
import { usePrecincts }   from '@/lib/hooks/usePrecincts'
import { useTripArtifacts } from '@/lib/hooks/useTripArtifacts'
import { useToast }       from '@/lib/hooks/useToast'
import {
  useResizablePanel,
  DETAIL_PANEL_MIN_W,
  DETAIL_PANEL_MAX_W,
} from '@/lib/hooks/useResizablePanel'
import { useElementWidth } from '@/lib/hooks/useElementWidth'
import { PHASE_NAMES }      from '@shared/lib/constants/phase-meta'
import { VerifyButton }       from '@/components/blockchain/VerifyButton'
import { ForensicOnly }       from '@/components/blockchain/ForensicOnly'
import { TripCreatedDetail }  from '@/components/domain/TripCreatedDetail'
import { ActivationDetail }   from '@/components/domain/ActivationDetail'
import { LoadingDetail }      from '@/components/domain/LoadingDetail'
import { DepartureDetail }    from '@/components/domain/DepartureDetail'
import { UnloadingDetail }    from '@/components/domain/UnloadingDetail'
import { ConfirmationDetail } from '@/components/domain/ConfirmationDetail'
import { InTransitTimeline }  from '@/components/domain/InTransitTimeline'
import { ExceptionEvidence }  from '@/components/domain/ExceptionEvidence'
import { ManifestPanel }      from '@/components/domain/ManifestPanel'
import { CancelTripAction }    from '@/components/domain/CancelTripAction'
import { PhaseOverrideAction } from '@/components/domain/PhaseOverrideAction'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { delayMinutes, fmtDelay } from '@/lib/format/schedule'
import { fmtExceptionType } from '@/lib/format/exception'
// Timeline grain vs record grain, per this module's own contract: fmtDateTime for events
// in the timeline, fmtFull (which carries the year) for the sidebar's records. The
// page-local formatter this replaces had no year at all, so a trip closed last March
// read "12 Mar" — and formatted the same field differently from its own child panels.
import { fmtDateTime, fmtFull } from '@shared/lib/utils/datetime'
import {
  activePhase, anchorTally, currentSealNumber, nodeTypeFor, originScannedCount,
  recordedExceptionLabel, sortedPlan, tripChipMeta,
} from '@/lib/phase/derive'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import type { Precinct } from '@shared/lib/types/precinct'
import type { BlockchainReceipt, BlockchainReceiptType, VerifyResult } from '@shared/lib/types/blockchain'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// ── Layout ────────────────────────────────────────────────────────────────────
// The two fixed costs in the three-column row. Declared here and applied as inline
// styles rather than as Tailwind arbitrary values (`min-w-[420px]`, `w-[304px]`),
// because the manifest's maximum width is computed FROM them — two literals that must
// agree, written twice, is how the manifest came to overflow the row and clip Trip Info.
const TIMELINE_MIN_W = 420
const SIDEBAR_W      = 304

// The manifest opens narrow and is dragged wider on demand. Deliberately not the shared
// DETAIL_PANEL_DEFAULT_W: that 520 is tuned for the fleet pages, where the panel IS the
// page. Here it is a third column stealing width from the timeline, which is what the
// dispatcher actually came to read — and its content (a waybill row, a total) needs far
// less room than a vehicle record does.
const MANIFEST_DEFAULT_W = 420

// ── Blockchain chain tag ──────────────────────────────────────────────────────
const HASHSCAN_BASE =
  process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? 'https://hashscan.io/testnet'

const RECEIPT_LABELS: Partial<Record<BlockchainReceiptType, string>> = {
  journey_lock:      'Journey lock anchored',
  pickup:            'Pickup receipt anchored',
  delivery:          'Delivery receipt anchored',
  checkpoint_batch:  'Checkpoint receipt anchored',
  exception_batch:   'Exception receipt anchored',
}

function ChainReceiptTag({ receipt }: { receipt: BlockchainReceipt }) {
  const [copied, setCopied] = useState(false)

  const isPending = !receipt.hedera_topic_id || receipt.hedera_topic_id === 'None'
  const truncated = `${receipt.data_hash.slice(0, 8)}…${receipt.data_hash.slice(-8)}`
  const label = RECEIPT_LABELS[receipt.receipt_type] ?? 'Receipt anchored'

  function copyHash() {
    navigator.clipboard.writeText(receipt.data_hash).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-chain-c rounded-sm px-[10px] py-[6px] mt-[6px]">
      <div className="flex items-center gap-[6px]">
        <Ic n="hex" s={12} className="text-chain" />
        <span className="text-[11px] font-[500] tracking-[0.04em] text-chain-onc">
          {label} · {isPending ? 'Pending anchor' : `Hedera seq #${receipt.hedera_sequence_number}`}
        </span>
      </div>
      <div className="flex items-center gap-[6px] mt-[3px]">
        <span className="font-mono text-[10px] tracking-[0.04em] text-chain-onc/80 tabular-nums flex-1">
          {truncated}
        </span>
        <button
          onClick={copyHash}
          className="shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[9px] font-[600] bg-chain-onc/15 text-chain-onc hover:bg-chain-onc/30 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        {!isPending && (
          <a
            href={`${HASHSCAN_BASE}/topic/${receipt.hedera_topic_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[9px] font-[600] bg-chain-onc/15 text-chain-onc hover:bg-chain-onc/30 transition-colors"
          >
            HashScan ↗
          </a>
        )}
      </div>
      {receipt.hedera_consensus_timestamp && (
        <div className="text-[10px] text-chain-onc/60 mt-[2px]">
          Anchored {fmtFull(receipt.hedera_consensus_timestamp)}
        </div>
      )}
    </div>
  )
}

// ── Single timeline event ─────────────────────────────────────────────────────
// 'next' vs 'active': see PhaseNodeType's doc comment in lib/phase/derive.ts —
// 'next' is the ledger's current gate with nothing yet done, 'active' is genuinely
// under way. Keeping the distinction here too, not just in the shared derivation,
// is what stops the trip-created-a-week-ahead phase from rendering as in-progress.
type NodeType = 'done' | 'active' | 'next' | 'warn' | 'cp' | 'pending'

interface TimelineEventProps {
  nodeType: NodeType
  nodeLabel: string | number
  isLast: boolean
  label: string
  meta: string
  detail?: string
  timestamp?: string
  chainReceipt?: BlockchainReceipt
  excText?: string
  resText?: string
  expandedContent?: React.ReactNode
  // Rendered unconditionally, unlike expandedContent which needs a click.
  alwaysExpandedContent?: React.ReactNode
  statusPill?: React.ReactNode
  // Exceptions nested within this phase card when expanded
  exceptions?: TripException[]
  showExceptionIndicator?: boolean
  // Required to render evidence artifacts in nested exceptions
  artifactsById?: Map<string, EvidenceArtifactWithUrl>
}


function TimelineEvent({
  nodeType, nodeLabel, isLast,
  label, meta, detail, timestamp,
  chainReceipt, excText, resText, expandedContent, alwaysExpandedContent,
  statusPill, exceptions, showExceptionIndicator, artifactsById,
}: TimelineEventProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // Every phase type now has its own detail component, so expanding in place is the
  // only interaction a card has. The manifest is reached from the sidebar instead,
  // which is why the old onCardClick escape hatch is gone.
  const isExpandable = !!expandedContent

  const nodeStyle: Record<NodeType, string> = {
    done:    'bg-ok text-white',
    active:  'bg-sec text-white animate-pulse',
    // Outlined, not filled — a filled/pulsing node reads as work already under way,
    // which is exactly the misleading state this type exists to avoid.
    next:    'bg-surf-lowest text-sec border-2 border-sec',
    warn:    'bg-warn-c text-warn-onc',
    cp:      'bg-surf-high text-on-surf-v',
    pending: 'bg-surf-high text-on-surf-v border border-outline-v',
  }
  const lineStyle: Record<NodeType, string> = {
    done:    'bg-ok/40',
    active:  'bg-outline-v/30',
    next:    'bg-outline-v/30',
    warn:    'bg-outline-v/30',
    cp:      'bg-ok/40',
    pending: 'bg-outline-v/30',
  }
  const cardStyle: Record<NodeType, string> = {
    done:    'bg-surf-low',
    active:  'bg-sec-c border border-sec/20',
    // Same idea as nodeStyle: a light outline says "this is what we're waiting
    // on", the solid sec-c fill used by `active` says "in progress" — which
    // nothing has done yet for a `next` phase.
    next:    'bg-surf-low border border-sec/30',
    warn:    'bg-warn-c/40 border border-warn/20',
    cp:      'bg-surf-low',
    pending: 'border border-dashed border-outline-v/40',
  }

  // Everything the collapsed card shows. Extracted so the expandable and inert variants
  // render identical content and cannot drift apart — only the wrapper differs.
  const summary = (
    <>
      <div className="flex items-start justify-between gap-3 mb-[5px]">
        <div className="flex items-center gap-[8px] min-w-0">
          <div className={`text-[15px] font-[700] leading-snug ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>
            {label}
          </div>
          {statusPill}
        </div>
        <div className="flex items-center gap-[8px] shrink-0">
          {timestamp && (
            <div className="flex items-center gap-[4px] tabular-nums text-[12px] font-[700] text-sec">
              <Ic n="clock" s={11} className="text-sec" />
              {fmtDateTime(timestamp)}
            </div>
          )}
          {/* The affordance. Its ABSENCE is equally load-bearing: a card with no chevron
              holds nothing to open, which is what stopped a dispatcher having to click
              every row to find out. `chev` points right, so rotate it for the open state. */}
          {isExpandable && (
            <Ic
              n="chev"
              s={14}
              className={`text-on-surf-v transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
        </div>
      </div>
      {meta && (
        <div className="text-[11px] font-[500] text-on-surf-v mb-[6px]">
          {meta}
        </div>
      )}
      {detail && <div className="text-[13px] text-on-surf-v mt-1">{detail}</div>}
      {exceptions && exceptions.length > 0 && showExceptionIndicator && (
        <div className="inline-flex items-center gap-[7px] bg-warn-c rounded-sm px-[12px] py-[5px] mt-[6px]">
          <Ic n="warn" s={13} className="text-warn-onc" />
          <span className="text-[12px] font-[600] text-warn-onc">
            {exceptions.length} exception{exceptions.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
      {excText && (
        <div className="inline-flex items-center gap-[7px] bg-warn-c rounded-sm px-[12px] py-[5px] mt-[6px]">
          <Ic n="warn" s={13} className="text-warn-onc" />
          <span className="text-[12px] font-[600] text-warn-onc">{excText}</span>
        </div>
      )}
      {resText && (
        <div className="text-[12px] text-ok mt-[5px] flex items-center gap-[5px]">
          <Ic n="check" s={12} className="text-ok" />
          {resText}
        </div>
      )}
    </>
  )

  return (
    <div className="flex gap-[14px]">
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11px] font-[700] shrink-0 ${nodeStyle[nodeType]}`}>
          {nodeType === 'done' || nodeType === 'cp'
            ? <Ic n="check" s={14} className="text-white" />
            : nodeLabel}
        </div>
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[20px] my-1 ${lineStyle[nodeType]}`} />
        )}
      </div>

      <div className="flex-1 mb-3">
        <div
          className={`rounded-lg px-4 py-3 ${cardStyle[nodeType]} ${isExpandable ? 'transition-shadow duration-150 hover:shadow-md' : ''}`}
        >
          {/* The toggle wraps the SUMMARY only, never the evidence below it. The whole
              card used to carry the onClick, so every Copy button, HashScan link and
              photo thumbnail inside the expanded panel bubbled a click straight back into
              it — opening a photo collapsed the card behind the lightbox. Interactive
              content also cannot legally nest inside a <button>. */}
          {isExpandable ? (
            <button
              type="button"
              onClick={() => setIsExpanded(e => !e)}
              aria-expanded={isExpanded}
              className="w-full text-left select-none rounded-md focus-visible:ring-2 focus-visible:ring-sec"
            >
              {summary}
            </button>
          ) : summary}

          {chainReceipt && <ForensicOnly><ChainReceiptTag receipt={chainReceipt} /></ForensicOnly>}
          {isExpanded && expandedContent}
          {isExpanded && exceptions && exceptions.length > 0 && !alwaysExpandedContent && artifactsById && (
            <div className="mt-[12px] border-t border-outline-v/20 pt-[12px]">
              <div className="text-[10px] font-[700] tracking-[0.09em] uppercase text-on-surf-v mb-[8px]">
                Exceptions ({exceptions.length})
              </div>
              <div className="flex flex-col gap-[8px]">
                {exceptions.map((exc) => (
                  <div key={exc.id} className="rounded-lg px-4 py-3 bg-warn-c/40 border border-warn/20">
                    <div className="flex items-start justify-between gap-3 mb-[5px]">
                      <span className="text-[13px] font-[600] text-warn-onc">
                        {fmtExceptionType(exc.exception_type)}
                      </span>
                      <span className="text-[11px] font-[600] text-sec tabular-nums shrink-0">
                        {fmtDateTime(exc.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-[6px] mb-[5px]">
                      <Chip
                        type={EXCEPTION_SEVERITY_META[exc.severity].chipType}
                        label={EXCEPTION_SEVERITY_META[exc.severity].label}
                      />
                      <span className="text-[10px] font-[500] text-on-surf-v">
                        {EXCEPTION_SOURCE_META[exc.source].label}
                      </span>
                    </div>
                    {exc.description && (
                      <div className="text-[12px] text-on-surf-v mb-[5px]">
                        {exc.description}
                      </div>
                    )}
                    {exc.resolved && (
                      <div className="text-[11px] text-ok flex items-center gap-[4px]">
                        <Ic n="check" s={11} className="text-ok" />
                        {exc.resolver_note ? `Resolved · ${exc.resolver_note}` : 'Resolved'}
                      </div>
                    )}
                    <ExceptionEvidence exception={exc} artifactsById={artifactsById} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {alwaysExpandedContent}
        </div>
      </div>
    </div>
  )
}

/**
 * One leg of the schedule: what was planned, what actually happened, and the gap.
 *
 * The actual row stays on screen as "Not yet" rather than being hidden when absent —
 * a missing actual against a planned time that has passed is itself the signal.
 */
function ScheduleRows({
  label, planned, actual,
}: {
  label: string
  planned: string | null
  actual: string | null
}) {
  const delay = delayMinutes(planned, actual)
  const lower = label.toLowerCase()

  return (
    <>
      <InfoRow label={`Planned ${lower}`} value={fmtFull(planned)} />

      {/* Mirrors InfoRow's own markup rather than composing it, because the delay has to
          sit INSIDE the actual's row — stacked under its timestamp and above the row's
          bottom border. Rendered as a sibling it detached from the fact it describes. */}
      <div className="flex justify-between items-start gap-3 py-[8px] border-b border-outline-v/20 last:border-0 text-[13px]">
        <span className="text-[11px] text-on-surf-v shrink-0 pt-[1px]">{`Actual ${lower}`}</span>
        <div className="text-right">
          <div className="font-[500] text-on-surf">{actual ? fmtFull(actual) : 'Not yet'}</div>
          {delay !== null && (
            // Early is not a success and late is not a failure — this platform records,
            // it does not judge. Only a genuinely on-time leg gets the positive colour.
            <div className={`text-[11px] tabular-nums font-[600] ${delay === 0 ? 'text-ok' : 'text-on-surf-v'}`}>
              {fmtDelay(delay)}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TripDetailPage() {
  const routeParams = useParams()
  const router = useRouter()

  const tripId = routeParams.id as string
  const { trip, isLoading, error, refetchSilent } = useTripDetail(tripId)
  const { precincts, error: precinctsError } = usePrecincts()
  const { byId: artifactsById } = useTripArtifacts(tripId)
  const { notify } = useToast()

  // Every precinct on this page — the header route, the Origin/Destination rows, each
  // phase card's stop label and the Route panel — is resolved by id against `precincts`
  // and falls back to an em-dash on a miss. That made a transient fetch failure read as
  // a trip with no origin, with nothing on screen to say otherwise. Error toasts are
  // sticky, so this stays visible until dismissed.
  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Origin, destination and stop names are missing, not absent.`,
      })
    }
  }, [precinctsError, notify])
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  // Trip-scoped, not phase-scoped (the manifest endpoint returns the same parcels
  // regardless of which phase card, if any, is open) — a plain toggle, not a
  // selected-phase id.
  const [manifestOpen, setManifestOpen] = useState(false)

  // Measured, not assumed. The manifest may only take space the timeline and Trip Info
  // are not entitled to, and Trip Info hides itself below xl — a hidden element measures
  // 0, so that breakpoint never has to be restated here.
  const { ref: rowRef,     width: rowWidth }     = useElementWidth<HTMLDivElement>()
  const { ref: sidebarRef, width: sidebarWidth } = useElementWidth<HTMLDivElement>()

  // Exactly the space left once the timeline has its minimum and Trip Info has its full
  // width — so the three columns sum to the row and never overflow it. Deliberately NOT
  // floored at DETAIL_PANEL_MIN_W: on a narrow viewport that floor is larger than what
  // is actually free, and the surplus came straight out of Trip Info, which the row's
  // `overflow-hidden` then clipped off the right edge.
  const manifestMax = Math.min(
    DETAIL_PANEL_MAX_W,
    Math.max(0, rowWidth - TIMELINE_MIN_W - sidebarWidth),
  )

  const { width: manifestWidth, startResize: startManifestResize } = useResizablePanel(
    MANIFEST_DEFAULT_W,
    // The handle sits on the panel's LEFT edge (ManifestPanel), so the panel grows as the
    // pointer moves left. Without this the drag ran backwards.
    { min: DETAIL_PANEL_MIN_W, max: manifestMax, edge: 'left' },
  )

  // Closed/cancelled trips only ever appear in trip history, so route back there;
  // every other status lives on the active-trips dashboard.
  const backTarget = trip && (trip.status === 'closed' || trip.status === 'cancelled')
    ? ROUTES.history
    : ROUTES.home

  const backButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => router.push(backTarget)}
      iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
    >
      Back
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Loading trip…" left={backButton} />
        <div className="flex items-center justify-center flex-1">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Trip not found" left={backButton} />
        <div className="p-6">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-on-surf-v" />}
            title="Trip not found"
            body={error ?? 'This trip does not exist or you do not have access to it.'}
            cta={<Button onClick={() => router.push(ROUTES.home)}>Back to Active Trips</Button>}
          />
        </div>
      </div>
    )
  }

  const originPrecinct = precincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = precincts.find(p => p.id === trip.destination_precinct_id)

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  const plan          = sortedPlan(trip.phases)
  const active        = activePhase(trip.phases)
  const tripCreation  = plan.find(p => p.phase_type === 'trip_creation') ?? null

  // U13: the chip names the phase — `Unloading` when active, `⚠ Unloading` when held.
  // Derived from the ledger, NOT from the trip's denormalised position cache — U3's
  // fence. The list view is allowed that cache because it has no plan; this page has
  // one, so it must use it.
  const statusMeta = tripChipMeta(trip.status, active?.phase_type ?? null)

  // Everything except trip_creation, which is rendered above the loop as the trip's
  // opening event. Filtered by TYPE, not by plan position — the plan index is data
  // and an index-based lookup would silently pick the wrong row on any plan that
  // ever started elsewhere.
  const timelinePhases = plan.filter(p => p.phase_type !== 'trip_creation')

  const sealNumber  = currentSealNumber(trip.phases)
  const originLoad  = plan.find(p => p.phase_type === 'loading') ?? null
  const tally       = anchorTally(trip.phases)

  // Stops in plan order, computed once. Every stop lookup below ranks by POSITION in this
  // array and never does arithmetic on the raw `sequence` value — real trip creation
  // numbers stops from 0 (trip_service.py) while seeded demo data numbers them from 1
  // (seed_trips.py), so `sequence + 1` is wrong on whichever convention it wasn't
  // written for, and non-contiguous sequences break it on both.
  const routeStops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)

  // What the waybills say SHOULD be aboard, versus what was actually counted at origin.
  // Two different facts: the first is booking data available from creation, the second is
  // evidence that only exists once a driver has counted. Null is NOT zero — a loading
  // phase that recorded no count must read as "not recorded", never as "0 parcels", or
  // the page reports an empty truck it has no evidence for.
  const originCount     = originScannedCount(trip.phases)
  const consignments    = trip.consignments
  const expectedParcels = consignments.reduce((n, c) => n + (c.parcel_count_expected ?? 0), 0)

  const journeyLockReceipt = trip.blockchain_receipts.find(r => r.receipt_type === 'journey_lock')

  // The coarse chip cannot say this: a trip that reaches `closed` carrying an exception
  // still renders a green "Complete". See recordedExceptionLabel.
  const exceptionLabel = recordedExceptionLabel(trip.exceptions, trip.phases)

  // A phase is anchored to a STOP, not to "origin or destination" — a cross-dock
  // trip has three, and an index-threshold guess cannot express the middle one.
  function precinctForStop(stopSequence: number | null): string {
    if (stopSequence === null) return '—'
    const stop = routeStops.find(s => s.sequence === stopSequence)
    const precinct = stop ? precincts.find(p => p.id === stop.precinct_id) : undefined
    return precinct?.name.split('—')[0]?.trim() ?? '—'
  }

  // precinctForStop returns a display name; the detail cards need the record itself
  // (coordinates, geofence radius, address).
  function precinctRecordForStop(stopSequence: number | null): Precinct | undefined {
    if (stopSequence === null) return undefined
    const stop = routeStops.find(s => s.sequence === stopSequence)
    return stop ? precincts.find(p => p.id === stop.precinct_id) : undefined
  }

  // The stop AFTER this one, by position on the route. An in-transit leg anchors to the
  // stop it DEPARTS FROM, so its destination is the next stop along — which is not
  // `sequence + 1`, a guess that only holds while sequences happen to be contiguous.
  function nextStopSequence(stopSequence: number | null): number | null {
    if (stopSequence === null) return null
    const rank = routeStops.findIndex(s => s.sequence === stopSequence)
    if (rank === -1 || rank + 1 >= routeStops.length) return null
    return routeStops[rank + 1].sequence
  }

  // Manifest baseline for a loading phase — summed from the consignments actually
  // booked to collect at THIS stop (Consignment.pickup_stop_id), never the trip-wide
  // `expectedParcels` total above: a cross-dock hub pickup must not be checked
  // against parcels a different stop collects. Null when nothing on the manifest is
  // booked at this stop — distinct from a real, if unusual, baseline of 0.
  function expectedCountForLoadingStop(tripStopId: string | null): number | null {
    if (tripStopId === null) return null
    // `consignments`, not `trip.consignments`: TS cannot carry the `!trip` guard's
    // narrowing into a nested function closure, so it re-widens `trip` to `Trip | null`
    // inside this scope. The local const stays narrowed.
    const atStop = consignments.filter(c => c.pickup_stop_id === tripStopId)
    if (atStop.length === 0) return null
    return atStop.reduce((n, c) => n + (c.parcel_count_expected ?? 0), 0)
  }

  // Live scan progress at a delivery stop — summed straight off the consignments
  // booked to arrive there (Consignment.delivery_stop_id), the same live-count
  // treatment expectedCountForLoadingStop gives the pickup side. This is NOT the
  // stamped parcel_count_destination on the CONFIRMATION row — that figure is
  // written once, after unloading has already closed, so a closed unloading row
  // never carries it. Null when nothing on the manifest is booked to arrive here —
  // distinct from a real 0 scanned so far.
  function scannedInCountForUnloadingStop(tripStopId: string | null): number | null {
    if (tripStopId === null) return null
    const atStop = consignments.filter(c => c.delivery_stop_id === tripStopId)
    if (atStop.length === 0) return null
    return atStop.reduce((n, c) => n + c.scanned_in_count, 0)
  }

  // Manifest baseline for an unloading stop — summed from the same delivery-side
  // consignments as scannedInCountForUnloadingStop, so the two are always comparable.
  function expectedCountForUnloadingStop(tripStopId: string | null): number | null {
    if (tripStopId === null) return null
    const atStop = consignments.filter(c => c.delivery_stop_id === tripStopId)
    if (atStop.length === 0) return null
    return atStop.reduce((n, c) => n + (c.parcel_count_expected ?? 0), 0)
  }

  // Live scan progress at a pickup stop — the counterpart to expectedCountForLoadingStop
  // above, but reading the recomputed-per-request scanned_out_count rather than the
  // manifest baseline. Shown by LoadingDetail only while the phase is still open; once
  // it resolves, phase.parcel_count_origin (the stamped tally) takes over.
  function scannedOutCountForLoadingStop(tripStopId: string | null): number | null {
    if (tripStopId === null) return null
    const atStop = consignments.filter(c => c.pickup_stop_id === tripStopId)
    if (atStop.length === 0) return null
    return atStop.reduce((n, c) => n + c.scanned_out_count, 0)
  }

  // Role (origin/destination) is derived, not stored (FP-112) — "Stop 0" told the
  // dispatcher nothing, so the first and last waypoint on the plan are labelled by
  // role and only a genuine mid-route leg falls back to a numbered "Stop N". Ranked
  // by POSITION among the trip's own stops, never by the raw sequence value —
  // real trip creation numbers stops from 0 (trip_service.py) but seeded demo data
  // numbers them from 1 (seed_trips.py), so comparing against a literal 0 or 1
  // silently breaks on whichever convention it wasn't written for.
  function stopRoleLabel(stopSequence: number | null): string {
    if (stopSequence === null) return ''
    const rank = routeStops.findIndex(s => s.sequence === stopSequence)
    if (rank === -1) return ''
    if (rank === 0) return 'Origin'
    if (rank === routeStops.length - 1) return 'Destination'
    return `Stop ${rank + 1}`
  }

  type TimelineItem = {
    phase: PhaseDescriptor
    nodeType: ReturnType<typeof nodeTypeFor>
    exceptions: Trip['exceptions']
  }
  const timelineItems: TimelineItem[] = timelinePhases.map(phase => ({
    phase,
    nodeType: nodeTypeFor(phase, active?.phase_event_id ?? null, trip.status),
    exceptions: [],
  }))
  // The backend tags every exception with the phase it occurred on (phase_event_id,
  // schemas/transit.py) — attach there directly. The field is nullable, not optional:
  // an exception raised outside any phase (e.g. panic button during IN_TRANSIT) carries null.
  // For untagged exceptions, use smart fallback: if it's a transit-friendly exception type and
  // an active phase exists, attach to that; otherwise fall back to the last completed phase.
  const IN_TRANSIT_FRIENDLY = new Set([
    'panic_button',           // driver-initiated, can happen anytime
    'seal_broken_in_transit', // explicitly in-transit
    'mechanical',             // driver, could happen during transit
    'dispatcher_note',        // dispatcher, could be anytime
    'escalation',             // dispatcher, could be anytime
  ])

  for (const exc of trip.exceptions) {
    const taggedIdx = exc.phase_event_id
      ? timelineItems.findIndex(i => i.phase.phase_event_id === exc.phase_event_id)
      : -1

    let attachIdx = -1
    if (taggedIdx >= 0) {
      attachIdx = taggedIdx
    } else {
      // Smart fallback: for transit-friendly exceptions, try to attach to active phase first
      const canUseActivePhase = IN_TRANSIT_FRIENDLY.has(exc.exception_type as any)
      const activeIdx = canUseActivePhase
        ? timelineItems.findIndex(i => i.nodeType === 'active')
        : -1

      if (activeIdx >= 0) {
        attachIdx = activeIdx
      } else {
        // Fall back to last completed/warning phase
        attachIdx = timelineItems.findLastIndex(i => i.nodeType === 'done' || i.nodeType === 'warn')
      }
    }

    if (attachIdx >= 0) timelineItems[attachIdx].exceptions.push(exc)
  }


  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title={trip.trip_reference}
        sub={`${trip.order_number} · ${originShort} → ${destShort} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'}`}
        left={backButton}
      >
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
        {/* Second chip, not a merged label: "closed" and "carries an exception" are two
            separate facts and one chip cannot hold both without one of them being lost.
            Amber rather than red — severity varies per record, and an info-level
            dispatcher note must not shout as loudly as a seal break. */}
        {exceptionLabel && <Chip type="exception" label={exceptionLabel} />}
      </TopBar>

      <div ref={rowRef} className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Timeline ── */}
        <div
          style={{ minWidth: TIMELINE_MIN_W }}
          className="flex-1 overflow-y-auto p-6 bg-surf-lowest"
        >

          <TimelineEvent
            nodeType="done"
            nodeLabel="0"
            isLast={timelinePhases.length === 0}
            label="Trip Created"
            meta="Dispatcher"
            detail={`${trip.order_number} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'} · ${expectedParcels} parcels booked`}
            timestamp={tripCreation?.completed_at ?? trip.created_at}
            chainReceipt={journeyLockReceipt}
            expandedContent={<TripCreatedDetail trip={trip} />}
          />

          {timelineItems.map((item, idx) => {
            const phase = item.phase
            const name  = PHASE_NAMES[phase.phase_type]
            const isLastItem = idx === timelineItems.length - 1

            // The same phase TYPE occurs more than once on a multi-stop plan, so the
            // stop is what disambiguates two `Loading` rows — never the index.
            const stopLabel = phase.stop_sequence === null
              ? ''
              : `${stopRoleLabel(phase.stop_sequence)} · ${precinctForStop(phase.stop_sequence)}`
            // Status now lives in the pill, so meta carries the stop only — leaving the
            // status word here printed it twice.
            const meta = stopLabel

            const detailParts: string[] = []
            if (phase.pulsit_geofence_confirmed === true)  detailParts.push('Pulsit geofence confirmed ✓')
            if (phase.pulsit_geofence_confirmed === false) detailParts.push('Pulsit geofence mismatch ✗')
            if (phase.parcel_count_origin !== null) detailParts.push(`${phase.parcel_count_origin} scanned`)
            // Each departure shows its OWN seal, so a cross-dock trip visibly carries
            // a different seal per leg. That is the multi-stop proof on screen.
            if (phase.seal_number)                  detailParts.push(`Seal ${phase.seal_number}`)
            const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined

            // Fail-open (parent D7): a completed phase whose anchor failed still owes a
            // receipt and must never read as an unqualified success. It gets the warning
            // treatment rather than sixth position in a grey dot-separated run-on, which
            // is where the one unresolved obligation on the card used to sit.
            const anchorWarning = phase.anchor_status === 'failed'
              ? 'Anchor failed — Hedera receipt still owed'
              : undefined

            const linkedReceipt = phase.blockchain_receipt_id
              ? trip.blockchain_receipts.find(r => r.id === phase.blockchain_receipt_id)
              : undefined

            const excItems = item.exceptions

            // An in-transit leg renders its own exceptions inside its Journey mini-timeline,
            // so it must NOT also emit them as sibling cards — that printed every en-route
            // exception twice, once in the leg and once below it.
            const ownsExceptionRows = phase.phase_type !== 'in_transit'
            const trailingExcCount  = ownsExceptionRows ? excItems.length : 0

            // A pending phase is a future event: it has no evidence yet, so it must not
            // expand, must not open the manifest panel, and must not even LOOK clickable.
            const isPending = item.nodeType === 'pending'
            // In-transit's own mini timeline already states "Arrived {destination}" with
            // this exact time, so the card-level timestamp is redundant and easy to misread
            // as the leg's departure time. Every other phase type keeps it.
            const cardTimestamp = phase.phase_type === 'in_transit' ? undefined : phase.completed_at ?? undefined

            return (
              <div key={phase.phase_event_id}>
                <TimelineEvent
                  nodeType={item.nodeType}
                  nodeLabel={phase.sequence_number}
                  isLast={isLastItem && trailingExcCount === 0}
                  label={name}
                  statusPill={
                    item.nodeType === 'active'  ? <Chip type="transit" label="In progress" /> :
                    // The ledger's current gate, but nothing has actually started — a
                    // trip created a week ahead must not claim its first phase is
                    // already under way just because it's next in line.
                    item.nodeType === 'next'    ? <Chip type="pending" label="Next" /> :
                    item.nodeType === 'pending' ? <Chip type="pending" label="Pending" /> :
                    item.nodeType === 'warn'    ? <Chip type="exception" label="Exception" /> :
                    undefined
                  }
                  meta={meta}
                  detail={detail}
                  excText={anchorWarning}
                  timestamp={cardTimestamp}
                  chainReceipt={linkedReceipt}
                  expandedContent={
                    isPending ? undefined
                    // Each per-type detail is followed by the override trigger — never
                    // duplicated inside the detail components themselves, since
                    // PhaseOverrideAction already gates on phase.status and is a no-op
                    // once a phase is resolved (PhaseOverrideSection takes over then).
                    : phase.phase_type === 'activation'
                      ? <>
                          <ActivationDetail
                            phase={phase}
                            trip={trip}
                            precinct={precinctRecordForStop(phase.stop_sequence)}
                            artifactsById={artifactsById}
                          />
                          <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={refetchSilent} />
                        </>
                    : phase.phase_type === 'loading'
                      ? <>
                          <LoadingDetail
                            phase={phase}
                            expectedCount={expectedCountForLoadingStop(phase.trip_stop_id)}
                            liveScannedOutCount={scannedOutCountForLoadingStop(phase.trip_stop_id)}
                          />
                          <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={refetchSilent} />
                        </>
                    : phase.phase_type === 'departure'
                      ? <>
                          <DepartureDetail
                            phase={phase}
                            precinct={precinctRecordForStop(phase.stop_sequence)}
                            artifactsById={artifactsById}
                          />
                          <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={refetchSilent} />
                        </>
                    : phase.phase_type === 'unloading'
                      ? <>
                          <UnloadingDetail
                            phase={phase}
                            allPhases={plan}
                            artifactsById={artifactsById}
                            scannedInCount={scannedInCountForUnloadingStop(phase.trip_stop_id)}
                            expectedAtStopCount={expectedCountForUnloadingStop(phase.trip_stop_id)}
                          />
                          <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={refetchSilent} />
                        </>
                    : phase.phase_type === 'confirmation'
                      ? <>
                          <ConfirmationDetail
                            phase={phase}
                            precinct={precinctRecordForStop(phase.stop_sequence)}
                            artifactsById={artifactsById}
                            originScannedCount={originCount}
                          />
                          <PhaseOverrideAction phase={phase} tripId={trip.id} tripStatus={trip.status} onOverridden={refetchSilent} />
                        </>
                    : undefined
                  }
                  alwaysExpandedContent={
                    isPending ? undefined
                    : phase.phase_type === 'in_transit'
                      ? <InTransitTimeline
                          phase={phase}
                          allPhases={plan}
                          exceptions={item.exceptions}
                          artifactsById={artifactsById}
                          originName={precinctForStop(phase.stop_sequence)}
                          destinationName={precinctForStop(nextStopSequence(phase.stop_sequence))}
                        />
                      : undefined
                  }
                  exceptions={ownsExceptionRows ? excItems : undefined}
                  showExceptionIndicator={excItems.length > 0 && !isPending}
                  artifactsById={artifactsById}
                />
              </div>
            )
          })}
        </div>

        {/* ── MIDDLE: Manifest panel — trip-scoped, opened from the sidebar's Cargo card ── */}
        {manifestOpen && (
          <ManifestPanel
            tripId={trip.id as string}
            heading="Trip Manifest"
            width={manifestWidth}
            onStartResize={startManifestResize}
            onClose={() => setManifestOpen(false)}
          />
        )}

        {/* ── RIGHT: Sidebar ── */}
        <div
          ref={sidebarRef}
          style={{ width: SIDEBAR_W }}
          className={`bg-surf-low p-5 overflow-y-auto shrink-0 border-l border-outline-v/20${
            manifestOpen ? ' hidden xl:block' : ''
          }`}
        >

          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Trip Info
          </div>
          <div className="bg-surf-lowest rounded-lg p-[12px_14px] mb-4 shadow-level-2">
            <div>
              <InfoRow label="Order"       value={trip.order_number}                mono />
              <InfoRow label="Driver"      value={trip.driver?.full_name ?? '—'} />
              <InfoRow label="Horse"       value={trip.horse?.registration ?? '—'}  mono />
              <InfoRow label="Origin"      value={originShort} />
              <InfoRow label="Destination" value={destShort} />
              {/* Planned and actual, paired. The backend has sent both since the trip
                  model existed and this card showed only the plan — so a trip that ran
                  eight days before it was scheduled to looked perfectly on schedule. */}
              <ScheduleRows
                label="Departure"
                planned={trip.planned_departure_at}
                actual={trip.actual_departure_at}
              />
              <ScheduleRows
                label="Arrival"
                planned={trip.planned_arrival_at}
                actual={trip.actual_arrival_at}
              />
              {trip.closed_at && <InfoRow label="Closed" value={fmtFull(trip.closed_at)} />}
            </div>
            {sealNumber && (
              <div className="flex justify-between items-center pt-[8px] mt-[2px] border-t border-outline-v/20 text-[13px]">
                <span className="text-[11px] text-on-surf-v shrink-0">Seal</span>
                {/* Shorthand tokens, matching the migration DepartureDetail already made
                    — same hex, real radius scale. This badge was the last holdout on the
                    legacy `bg-primary`/`text-white`/`var(--r-sm)` trio. */}
                <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-on-surf text-surf-lowest rounded-sm px-[10px] py-[3px]">
                  {sealNumber}
                </span>
              </div>
            )}
          </div>

          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
            Route
          </div>
          <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-4 text-[13px] shadow-level-2">
            {routeStops.map((stop, i, arr) => {
              const precinct = precincts.find(p => p.id === stop.precinct_id)
              const name = precinct?.name.split('—')[0]?.trim() ?? '—'
              return (
                <div
                  key={stop.id}
                  className={`flex items-start gap-[8px] py-[6px]${i < arr.length - 1 ? ' border-b border-outline-v/20' : ''}`}
                >
                  <span className="w-[18px] h-[18px] rounded-full bg-surf-high text-on-surf-v text-[10px] font-[700] flex items-center justify-center shrink-0 mt-[1px]">
                    {/* Rank, not `sequence + 1` — seeded trips number stops from 1, so the
                        raw value rendered a route that began at "2". */}
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-[500] text-on-surf truncate">{name}</div>
                    {stop.slot_time && (
                      <div className="text-[11px] text-on-surf-v tabular-nums">
                        Slot {fmtDateTime(stop.slot_time)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
            Cargo
          </div>
          <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-4 text-[13px] shadow-level-2">
            <div className="font-[600] text-on-surf tabular-nums">
              {trip.consignments.length} waybill{trip.consignments.length === 1 ? '' : 's'}
            </div>
            {/* Booked vs counted, kept apart. The first comes from the waybills at
                creation; the second is evidence a driver produced at the gate. Collapsing
                them into one "N parcels" line — with a null counted value coalesced to
                zero — is how this card came to report an empty truck. */}
            <div className="text-[11px] text-on-surf-v tabular-nums mt-[2px]">
              {expectedParcels} parcels booked
            </div>
            <div className={`text-[11px] tabular-nums mt-[1px] ${originCount === null ? 'text-on-surf-v' : 'text-on-surf'}`}>
              {originCount === null
                ? 'Origin count not recorded'
                : `${originCount} counted at origin`}
            </div>
            {/* States the phase fact it actually has. The old copy claimed "All scanned
                out at origin", which is a Parcel Perfect scan assertion this page never
                checked — the manifest carrying origin_scan_complete is only fetched when
                the panel below is opened. */}
            {originLoad?.status === 'completed' && (
              <div className="text-[11px] text-ok mt-[3px] flex items-center gap-1">
                <Ic n="check" s={11} className="text-ok" />
                Loading complete at origin
              </div>
            )}
            <button
              onClick={() => setManifestOpen(true)}
              className="w-full mt-[8px] pt-[8px] border-t border-outline-v/20 text-[11px] font-[600] text-sec hover:text-on-surf transition-colors text-left"
            >
              View manifest →
            </button>
          </div>

          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
            Blockchain
          </div>
          {(() => {
            const v = verifyResult
            const isOk      = v?.status === 'verified'
            const isMismatch = v?.status === 'db_mismatch' || v?.status === 'hedera_mismatch'
            const isWarn    = v?.status === 'error'
            const cardBg    = isOk ? 'bg-ok-c' : isMismatch ? 'bg-err-c' : isWarn ? 'bg-warn-c' : 'bg-chain-c'
            const iconCl    = isOk ? 'text-ok'  : isMismatch ? 'text-err'  : isWarn ? 'text-warn'  : 'text-chain'
            const labelCl   = isOk ? 'text-on-ok-c' : isMismatch ? 'text-on-err-c' : isWarn ? 'text-on-warn-c' : 'text-chain-onc'
            const subCl     = isOk ? 'text-ok'  : isMismatch ? 'text-err'  : isWarn ? 'text-warn'  : 'text-chain'
            return (
              <div className={`${cardBg} rounded-md p-[10px_12px] mb-4 leading-relaxed transition-colors duration-300`}>
                <ForensicOnly>
                  <div className="flex items-center gap-[5px] mb-1">
                    <Ic n="hex" s={12} className={iconCl} />
                    <span className={`text-[11px] font-[500] tracking-[0.04em] ${labelCl}`}>
                      {tally.anchored} of {tally.owed} receipts anchored
                    </span>
                  </div>
                  {tally.failed > 0 && (
                    <div className="text-[11px] font-[600] text-warn mb-1">
                      ⚠ {tally.failed} anchor{tally.failed > 1 ? 's' : ''} failed — receipt{tally.failed > 1 ? 's' : ''} still owed
                    </div>
                  )}
                  {trip.blockchain_receipts.slice(0, 3).map(r => (
                    <div key={r.id} className={`text-[11px] tracking-[0.03em] truncate tabular-nums ${subCl}`}>
                      {r.hedera_topic_id} #{r.hedera_sequence_number}
                    </div>
                  ))}
                </ForensicOnly>
                <VerifyButton subjectType="trip" subjectId={trip.id as string} autoVerify onResult={setVerifyResult} />
              </div>
            )
          })()}

          {/* Terminal lifecycle exit — deliberately last in the rail, away from the
              read-only cards above it. The whole section (not just the button) is
              hidden once the trip is already closed or cancelled, so there is never
              an "Actions" heading sitting above nothing to act on. */}
          {trip.status !== 'closed' && trip.status !== 'cancelled' && (
            <>
              <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
                Actions
              </div>
              <CancelTripAction tripId={trip.id} status={trip.status} onCancelled={refetchSilent} />
            </>
          )}

        </div>
      </div>
    </div>
  )
}
