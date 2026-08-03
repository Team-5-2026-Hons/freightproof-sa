'use client'

import { useState } from 'react'
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
import {
  useResizablePanel,
  DETAIL_PANEL_DEFAULT_W,
  DETAIL_PANEL_MIN_W,
  DETAIL_PANEL_MAX_W,
} from '@/lib/hooks/useResizablePanel'
import { PHASE_NAMES }      from '@shared/lib/constants/phase-meta'
import { VerifyButton }       from '@/components/blockchain/VerifyButton'
import { ForensicOnly }       from '@/components/blockchain/ForensicOnly'
import { TripCreatedDetail }  from '@/components/domain/TripCreatedDetail'
import { ActivationDetail }   from '@/components/domain/ActivationDetail'
import { DepartureDetail }    from '@/components/domain/DepartureDetail'
import { ConfirmationDetail } from '@/components/domain/ConfirmationDetail'
import { InTransitTimeline }  from '@/components/domain/InTransitTimeline'
import { ManifestPanel }      from '@/components/domain/ManifestPanel'
import {
  activePhase, anchorTally, currentSealNumber, nodeTypeFor, originParcelCount,
  sortedPlan, tripChipMeta,
} from '@/lib/phase/derive'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import type { BlockchainReceipt, BlockchainReceiptType, VerifyResult } from '@shared/lib/types/blockchain'

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
          Anchored {fmtTs(receipt.hedera_consensus_timestamp)}
        </div>
      )}
    </div>
  )
}

// ── Single timeline event ─────────────────────────────────────────────────────
type NodeType = 'done' | 'active' | 'warn' | 'cp' | 'pending'

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
  // When set, the card opens the manifest panel instead of (or as well as) toggling
  // expandedContent — loading/unloading cards have no expandedContent of their own.
  onCardClick?: () => void
}

function fmtTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

function TimelineEvent({
  nodeType, nodeLabel, isLast,
  label, meta, detail, timestamp,
  chainReceipt, excText, resText, expandedContent, alwaysExpandedContent,
  statusPill, onCardClick,
}: TimelineEventProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isExpandable  = !!expandedContent
  // A card is interactive either because it expands in place, or because it opens the
  // manifest panel (loading/unloading, which have no expandedContent of their own).
  const isInteractive = isExpandable || !!onCardClick

  const nodeStyle: Record<NodeType, string> = {
    done:    'bg-ok text-white',
    active:  'bg-sec text-white animate-pulse',
    warn:    'bg-warn-c text-warn-onc',
    cp:      'bg-surf-high text-on-surf-v',
    pending: 'bg-surf-high text-on-surf-v border border-outline-v',
  }
  const lineStyle: Record<NodeType, string> = {
    done:    'bg-ok/40',
    active:  'bg-outline-v/30',
    warn:    'bg-outline-v/30',
    cp:      'bg-ok/40',
    pending: 'bg-outline-v/30',
  }
  const cardStyle: Record<NodeType, string> = {
    done:    'bg-surf-low',
    active:  'bg-sec-c border border-sec/20',
    warn:    'bg-warn-c/40 border border-warn/20',
    cp:      'bg-surf-low',
    pending: 'border border-dashed border-outline-v/40',
  }

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
          className={`rounded-lg px-4 py-3 ${cardStyle[nodeType]} ${isInteractive ? 'cursor-pointer transition-shadow duration-150 hover:shadow-md active:shadow-sm select-none' : ''}`}
          onClick={
            onCardClick ? onCardClick
            : isExpandable ? () => setIsExpanded(e => !e)
            : undefined
          }
        >
          <div className="flex items-start justify-between gap-3 mb-[5px]">
            <div className="flex items-center gap-[8px] min-w-0">
              <div className={`text-[15px] font-[700] leading-snug ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>
                {label}
              </div>
              {statusPill}
            </div>
            {timestamp && (
              <div className="flex items-center gap-[4px] shrink-0 tabular-nums text-[12px] font-[700] text-sec">
                <Ic n="clock" s={11} className="text-sec" />
                {fmtTs(timestamp)}
              </div>
            )}
          </div>
          {meta && (
            <div className="text-[11px] font-[500] text-on-surf-v mb-[6px]">
              {meta}
            </div>
          )}
          {detail && <div className="text-[13px] text-on-surf-v mt-1">{detail}</div>}
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
          {chainReceipt && <ForensicOnly><ChainReceiptTag receipt={chainReceipt} /></ForensicOnly>}
          {isExpanded && expandedContent}
          {alwaysExpandedContent}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TripDetailPage() {
  const routeParams = useParams()
  const router = useRouter()

  const tripId = routeParams.id as string
  const { trip, isLoading, error } = useTripDetail(tripId)
  const { precincts } = usePrecincts()
  const { byId: artifactsById } = useTripArtifacts(tripId)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  const [selectedManifestPhase, setSelectedManifestPhase] = useState<PhaseEventId | null>(null)
  const { width: manifestWidth, startResize: startManifestResize } = useResizablePanel(
    DETAIL_PANEL_DEFAULT_W, { min: DETAIL_PANEL_MIN_W, max: DETAIL_PANEL_MAX_W },
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

  // Resolved from the plan by id, never held as an object in state — a refetch replaces
  // the descriptors and a captured object would go stale. This is also what lets two
  // `loading` occurrences on a cross-dock plan open their OWN manifest slice: the id is
  // unique per phase event, so keying on it (rather than phase_type or plan index) can
  // never conflate the origin load with a mid-route reload.
  const selectedManifest = selectedManifestPhase
    ? plan.find(p => p.phase_event_id === selectedManifestPhase) ?? null
    : null

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
  const parcelCount = originParcelCount(trip.phases) ?? 0
  const tally       = anchorTally(trip.phases)

  // A phase is anchored to a STOP, not to "origin or destination" — a cross-dock
  // trip has three, and an index-threshold guess cannot express the middle one.
  function precinctForStop(stopSequence: number | null): string {
    if (stopSequence === null) return '—'
    // `trip` is narrowed above, but TS does not carry that narrowing into a nested
    // function declaration (it could be called later, after a hypothetical reassignment) —
    // the `!` is required here, not a shortcut around a real possibly-null case.
    const stop = trip!.stops.find(s => s.sequence === stopSequence)
    const precinct = stop ? precincts.find(p => p.id === stop.precinct_id) : undefined
    return precinct?.name.split('—')[0]?.trim() ?? '—'
  }

  // precinctForStop returns a display name; the detail cards need the record itself
  // (coordinates, geofence radius, address).
  function precinctRecordForStop(stopSequence: number | null): Precinct | undefined {
    if (stopSequence === null) return undefined
    const stop = trip!.stops.find(s => s.sequence === stopSequence)
    return stop ? precincts.find(p => p.id === stop.precinct_id) : undefined
  }

  type TimelineItem = {
    phase: PhaseDescriptor
    nodeType: ReturnType<typeof nodeTypeFor>
    exceptions: Trip['exceptions']
  }
  const timelineItems: TimelineItem[] = timelinePhases.map(phase => ({
    phase,
    nodeType: nodeTypeFor(phase, active?.phase_event_id ?? null),
    exceptions: [],
  }))
  // APPROXIMATE, and knowingly so. Exceptions are bolted onto the last done/warn row
  // because the shared TripException type still declares `handshake_event_id` while the
  // backend has moved to `phase_event_id` (schemas/transit.py). Once Stage 5 renames
  // that field, attach by exc.phase_event_id and delete this loop. Until then the
  // in-transit timeline shows index-guessed placement, which must not be presented as
  // phase-accurate.
  for (const exc of trip.exceptions) {
    const targetIdx = timelineItems.findLastIndex(i => i.nodeType === 'done' || i.nodeType === 'warn')
    if (targetIdx >= 0) timelineItems[targetIdx].exceptions.push(exc)
  }


  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title={trip.trip_reference}
        sub={`${trip.order_number} · ${originShort} → ${destShort} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'}`}
        left={backButton}
      >
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
      </TopBar>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Timeline ── */}
        <div className="flex-1 min-w-[420px] overflow-y-auto p-6 bg-surf-lowest">

          <TimelineEvent
            nodeType="done"
            nodeLabel="0"
            isLast={timelinePhases.length === 0}
            label="Trip Created"
            meta="Dispatcher"
            detail={`${trip.order_number} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'} · ${parcelCount} parcels`}
            timestamp={tripCreation?.completed_at ?? trip.created_at}
            chainReceipt={trip.blockchain_receipts[0]}
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
              : `Stop ${phase.stop_sequence} · ${precinctForStop(phase.stop_sequence)}`
            // Status now lives in the pill, so meta carries the stop only — leaving the
            // status word here printed it twice.
            const meta = stopLabel

            const detailParts: string[] = []
            if (phase.pulsit_geofence_confirmed === true)  detailParts.push('Pulsit geofence confirmed ✓')
            if (phase.pulsit_geofence_confirmed === false) detailParts.push('Pulsit geofence mismatch ✗')
            if (phase.parcel_count_origin !== null) detailParts.push(`${phase.parcel_count_origin} parcels`)
            // Each departure shows its OWN seal, so a cross-dock trip visibly carries
            // a different seal per leg. That is the multi-stop proof on screen.
            if (phase.seal_number)                  detailParts.push(`Seal ${phase.seal_number}`)
            // Fail-open (parent D7): a completed phase whose anchor failed still owes
            // a receipt, and must never read as an unqualified success.
            if (phase.anchor_status === 'failed')   detailParts.push('⚠ Anchor failed — receipt owed')
            const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined

            const linkedReceipt = phase.blockchain_receipt_id
              ? trip.blockchain_receipts.find(r => r.id === phase.blockchain_receipt_id)
              : undefined

            const excItems = item.exceptions

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
                  isLast={isLastItem && excItems.length === 0}
                  label={name}
                  statusPill={
                    item.nodeType === 'active'  ? <Chip type="transit" label="In progress" /> :
                    item.nodeType === 'pending' ? <Chip type="pending" label="Pending" /> :
                    item.nodeType === 'warn'    ? <Chip type="exception" label="Exception" /> :
                    undefined
                  }
                  meta={meta}
                  detail={detail}
                  timestamp={cardTimestamp}
                  chainReceipt={linkedReceipt}
                  expandedContent={
                    isPending ? undefined
                    : phase.phase_type === 'activation'
                      ? <ActivationDetail
                          phase={phase}
                          trip={trip}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
                    : phase.phase_type === 'departure'
                      ? <DepartureDetail
                          phase={phase}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
                    : phase.phase_type === 'confirmation'
                      ? <ConfirmationDetail
                          phase={phase}
                          precinct={precinctRecordForStop(phase.stop_sequence)}
                          artifactsById={artifactsById}
                        />
                    : undefined
                  }
                  alwaysExpandedContent={
                    isPending ? undefined
                    : phase.phase_type === 'in_transit'
                      ? <InTransitTimeline
                          phase={phase}
                          exceptions={item.exceptions}
                          originName={precinctForStop(phase.stop_sequence)}
                          destinationName={precinctForStop(
                            phase.stop_sequence === null ? null : phase.stop_sequence + 1,
                          )}
                        />
                      : undefined
                  }
                  onCardClick={
                    isPending ? undefined
                    : phase.phase_type === 'loading' || phase.phase_type === 'unloading'
                      ? () => setSelectedManifestPhase(
                          current => current === phase.phase_event_id ? null : phase.phase_event_id,
                        )
                      : undefined
                  }
                />
                {excItems.map((exc, ei) => (
                  <TimelineEvent
                    key={exc.id}
                    nodeType="warn"
                    nodeLabel="!"
                    isLast={isLastItem && ei === excItems.length - 1}
                    label={`Exception: ${exc.exception_type.replace(/_/g, ' ')}`}
                    meta={`${new Date(exc.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} · Source: ${exc.source}`}
                    excText={exc.description}
                    resText={
                      exc.resolved && exc.resolver_note
                        ? `Resolved · ${exc.resolver_note}`
                        : undefined
                    }
                  />
                ))}
              </div>
            )
          })}
        </div>

        {/* ── MIDDLE: Manifest panel (only while a loading/unloading card is selected) ── */}
        {selectedManifest && (
          <ManifestPanel
            tripId={trip.id as string}
            mode={selectedManifest.phase_type === 'loading' ? 'loading' : 'unloading'}
            heading={`Manifest · ${PHASE_NAMES[selectedManifest.phase_type]}${
              selectedManifest.stop_sequence === null
                ? ''
                : ` · Stop ${selectedManifest.stop_sequence} · ${precinctForStop(selectedManifest.stop_sequence)}`
            }`}
            width={manifestWidth}
            onStartResize={startManifestResize}
            onClose={() => setSelectedManifestPhase(null)}
            parcelCountDestination={selectedManifest.parcel_count_destination}
            driverVisualCount={selectedManifest.driver_visual_count}
          />
        )}

        {/* ── RIGHT: Sidebar ── */}
        <div className={`w-[256px] bg-surf-low p-5 overflow-y-auto shrink-0 border-l border-outline-v/20${
          selectedManifest ? ' hidden xl:block' : ''
        }`}>

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
            </div>
            {sealNumber && (
              <div className="flex justify-between items-center pt-[8px] mt-[2px] border-t border-outline-v/20 text-[13px]">
                <span className="text-[11px] text-on-surf-v shrink-0">Seal</span>
                <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-primary text-white rounded-[var(--r-sm)] px-[10px] py-[3px]">
                  {sealNumber}
                </span>
              </div>
            )}
          </div>

          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
            Route
          </div>
          <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-4 text-[13px] shadow-level-2">
            {[...trip.stops].sort((a, b) => a.sequence - b.sequence).map((stop, i, arr) => {
              const precinct = precincts.find(p => p.id === stop.precinct_id)
              const name = precinct?.name.split('—')[0]?.trim() ?? '—'
              return (
                <div
                  key={stop.id}
                  className={`flex items-start gap-[8px] py-[6px]${i < arr.length - 1 ? ' border-b border-outline-v/20' : ''}`}
                >
                  <span className="w-[18px] h-[18px] rounded-full bg-surf-high text-on-surf-v text-[10px] font-[700] flex items-center justify-center shrink-0 mt-[1px]">
                    {stop.sequence + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-[500] text-on-surf truncate">{name}</div>
                    {stop.slot_time && (
                      <div className="text-[11px] text-on-surf-v tabular-nums">
                        Slot {fmtTs(stop.slot_time)}
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
            <div className="text-[11px] text-on-surf-v tabular-nums mt-[2px]">
              {parcelCount} parcels
            </div>
            {originLoad?.status === 'completed' && (
              <div className="text-[11px] text-ok mt-[3px] flex items-center gap-1">
                <Ic n="check" s={11} className="text-ok" />
                All scanned out at origin ✓
              </div>
            )}
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

        </div>
      </div>
    </div>
  )
}
