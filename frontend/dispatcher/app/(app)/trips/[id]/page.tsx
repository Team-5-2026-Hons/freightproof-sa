'use client'

import { useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Ic }         from '@/components/ui/Ic'
import { EmptyState } from '@/components/ui/EmptyState'
import { ROUTES }     from '@/lib/constants/routes'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { HANDSHAKE_NAMES }  from '@shared/lib/constants/handshake-meta'
import { mockTrips }    from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { mockManifests } from '@shared/lib/mocks/manifests'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import type { Trip } from '@shared/lib/types/trip'

// Maps trip status to which sequence number is currently the active (in-progress) handshake.
// `in_transit` has no active handshake (vehicle is on the road between H3 and H4).
const ACTIVE_HS_FOR_STATUS: Partial<Record<string, number>> = {
  origin_gate_in:  1,
  loading:         2,
  origin_gate_out: 3,
  dest_gate_in:    4,
  unloading:       5,
}

// ── Blockchain chain tag ──────────────────────────────────────────────────────
// Displays a Hedera topic + sequence reference. BlockchainReceipt has no
// hedera_transaction_id field — we compose a reference from topic_id + sequence_number.
function ChainTag({ text }: { text: string }) {
  return (
    <div className="inline-flex items-center gap-[6px] bg-chain-c rounded-sm px-[10px] py-[5px] mt-[6px]">
      <Ic n="hex" s={12} className="text-chain" />
      <span className="text-[11px] font-[500] tracking-[0.04em] tabular-nums leading-relaxed text-chain-onc">
        {text}
      </span>
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
  /** ISO timestamp shown top-right when the event was completed. */
  timestamp?: string
  chainText?: string
  excText?: string
  resText?: string
}

function fmtTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

function TimelineEvent({
  nodeType, nodeLabel, isLast,
  label, meta, detail, timestamp,
  chainText, excText, resText,
}: TimelineEventProps) {
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
  // Card background visually groups each event's content
  const cardStyle: Record<NodeType, string> = {
    done:    'bg-surf-low',
    active:  'bg-sec-c border border-sec/20',
    warn:    'bg-warn-c/40 border border-warn/20',
    cp:      'bg-surf-low',
    pending: 'border border-dashed border-outline-v/40',
  }

  return (
    <div className="flex gap-[14px]">
      {/* Node + vertical connector */}
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

      {/* Content card — one card per event, timestamp pinned inside */}
      <div className="flex-1 mb-3">
        <div className={`rounded-lg px-4 py-3 ${cardStyle[nodeType]}`}>
          {/* Title row — event name left, timestamp top-right inside the card */}
          <div className="flex items-start justify-between gap-3 mb-[5px]">
            <div className={`text-[15px] font-[700] leading-snug ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>
              {label}
            </div>
            {timestamp && (
              <div className="flex items-center gap-[4px] shrink-0 tabular-nums text-[12px] font-[700] text-sec">
                <Ic n="clock" s={11} className="text-sec" />
                {fmtTs(timestamp)}
              </div>
            )}
          </div>
          {/* Context line — location / actor / status */}
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
          {chainText && <ChainTag text={chainText} />}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TripDetailPage() {
  const params = useParams()
  const router = useRouter()

  const tripId = params.id as string
  const trip   = useMemo(() => mockTrips.find(t => t.id === tripId), [tripId])

  if (!trip) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Trip not found">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(ROUTES.home)}
            iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
          >
            Back
          </Button>
        </TopBar>
        <div className="p-6">
          <EmptyState
            icon={<Ic n="warn" s={32} className="text-on-surf-v" />}
            title="Trip not found"
            body="This trip does not exist or you do not have access to it."
            cta={<Button onClick={() => router.push(ROUTES.home)}>Back to Active Trips</Button>}
          />
        </div>
      </div>
    )
  }

  const statusMeta     = TRIP_STATUS_META[trip.status]
  const originPrecinct = mockPrecincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = mockPrecincts.find(p => p.id === trip.destination_precinct_id)
  const manifest       = mockManifests.find(m => m.trip_id === trip.id)

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  // Seal number from the first handshake that recorded one
  const sealNumber = trip.handshakes.find(h => h.seal_number)?.seal_number

  // Which sequence number is currently active (in-progress) based on trip status
  const activeHsNum = ACTIVE_HS_FOR_STATUS[trip.status]

  // Separate the trip_creation handshake (seq 0) from the five gate handshakes (seq 1-5).
  // seq-0 is rendered as a fixed first event; the loop handles seq 1-5 only.
  const allSorted = [...trip.handshakes].sort((a, b) => a.sequence_number - b.sequence_number)
  const tripCreationHs = allSorted.find(h => h.sequence_number === 0)
  const sortedHandshakes = allSorted.filter(h => h.sequence_number > 0)

  // Parcel count: prefer loading handshake scan count, fall back to manifest sum
  const loadingHs = sortedHandshakes.find(h => h.sequence_number === 2)
  const parcelCount =
    loadingHs?.parcel_count_origin ??
    manifest?.stops.reduce((sum, stop) => sum + stop.parcel_count, 0) ??
    0

  // Number of blockchain receipts anchored for this trip
  const anchoredCount = trip.blockchain_receipts.length

  // Build timeline item metadata — maps each handshake to its node type and
  // collects any exceptions to render inline beneath the nearest done handshake.
  type TimelineItem = {
    seqNum: number
    nodeType: NodeType
    exceptions: Trip['exceptions']
  }
  const timelineItems: TimelineItem[] = sortedHandshakes.map(hs => {
    let nodeType: NodeType
    if (hs.status === 'completed' || hs.status === 'overridden') {
      nodeType = 'done'
    } else if (hs.status === 'exception') {
      nodeType = 'warn'
    } else if (hs.status === 'in_progress' || hs.sequence_number === activeHsNum) {
      nodeType = 'active'
    } else {
      nodeType = 'pending'
    }
    return { seqNum: hs.sequence_number, nodeType, exceptions: [] }
  })
  for (const exc of trip.exceptions) {
    const targetIdx = timelineItems.findLastIndex(i => i.nodeType === 'done' || i.nodeType === 'warn')
    if (targetIdx >= 0) timelineItems[targetIdx].exceptions.push(exc)
  }

  // Compose a human-readable Hedera reference from topic + sequence number.
  // BlockchainReceipt has no hedera_transaction_id field in this schema version.
  function hederaRef(topicId: string, seqNum: number): string {
    return `Hedera ${topicId} seq #${seqNum}`
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top bar — richer sub line with order, route, driver, horse */}
      <TopBar
        title={trip.trip_reference}
        sub={`${trip.order_number} · ${originShort} → ${destShort} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'}`}
      >
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
        <Button variant="secondary" size="sm" iconLeft={<Ic n="file" s={13} className="text-on-surf" />}>
          Add Note
        </Button>
        <Button size="sm" iconLeft={<Ic n="dl" s={13} className="text-white" />}>
          Export Evidence PDF
        </Button>
      </TopBar>

      {/* Two-column body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Timeline ── */}
        <div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">

          {/* Trip Created event — always first, anchored with journey lock hash */}
          <TimelineEvent
            nodeType="done"
            nodeLabel="0"
            isLast={sortedHandshakes.length === 0}
            label="Trip Created"
            meta="Dispatcher"
            detail={`${trip.order_number} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'} · ${parcelCount} parcels`}
            timestamp={tripCreationHs?.completed_at ?? trip.created_at}
            chainText={
              trip.blockchain_receipts[0]
                ? `Journey lock hash anchored · ${hederaRef(trip.blockchain_receipts[0].hedera_topic_id, trip.blockchain_receipts[0].hedera_sequence_number)}`
                : undefined
            }
          />

          {/* Handshake events — one per sorted handshake, with exceptions inline */}
          {timelineItems.map((item, idx) => {
            const hs     = sortedHandshakes[idx]
            const hsName = HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]
            const isLastItem = idx === timelineItems.length - 1

            // Context line — location when done, status when not yet completed.
            // Time is shown separately via the `timestamp` prop so it isn't duplicated here.
            const locationPart = hs.sequence_number <= 3 ? originShort : destShort
            const meta = hs.completed_at
              ? locationPart
              : item.nodeType === 'active' ? 'In progress'
              : item.nodeType === 'warn'   ? 'Exception'
              : 'Pending'

            // Detail line — concatenate non-null data points
            const detailParts: string[] = []
            if (hs.pulsit_geofence_confirmed === true)  detailParts.push('Pulsit geofence confirmed ✓')
            if (hs.pulsit_geofence_confirmed === false)  detailParts.push('Pulsit geofence mismatch ✗')
            if (hs.parcel_count_origin !== null)  detailParts.push(`${hs.parcel_count_origin} parcels`)
            if (hs.seal_number)                   detailParts.push(`Seal ${hs.seal_number}`)
            const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined

            // Find a blockchain receipt linked to this handshake (by blockchain_receipt_id on the hs)
            const linkedReceipt = hs.blockchain_receipt_id
              ? trip.blockchain_receipts.find(r => r.id === hs.blockchain_receipt_id)
              : undefined
            const chainText = linkedReceipt
              ? `Receipt anchored · ${hederaRef(linkedReceipt.hedera_topic_id, linkedReceipt.hedera_sequence_number)}`
              : undefined

            const excItems = item.exceptions

            return (
              <div key={hs.id}>
                <TimelineEvent
                  nodeType={item.nodeType}
                  nodeLabel={hs.sequence_number}
                  isLast={isLastItem && excItems.length === 0}
                  label={
                    item.nodeType === 'active'
                      ? `${hsName} — IN PROGRESS`
                      : item.nodeType === 'pending'
                      ? `${hsName} — PENDING`
                      : hsName
                  }
                  meta={meta}
                  detail={detail}
                  timestamp={hs.completed_at ?? undefined}
                  chainText={chainText}
                />
                {/* Exceptions rendered inline beneath the parent handshake event */}
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

        {/* ── RIGHT: Sidebar ── */}
        <div className="w-[256px] bg-surf-low p-5 overflow-y-auto shrink-0 border-l border-outline-v/20">

          {/* TRIP INFO */}
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Trip Info
          </div>
          <div className="bg-surf-lowest rounded-lg p-[12px_14px] mb-4 shadow-level-2">
            {([
              { label: 'Order',       value: trip.order_number,               mono: true  },
              { label: 'Driver',      value: trip.driver?.full_name ?? '—',   mono: false },
              { label: 'Horse',       value: trip.horse?.registration ?? '—', mono: true  },
              { label: 'Origin',      value: originShort,                      mono: false },
              { label: 'Destination', value: destShort,                        mono: false },
              { label: 'Route',       value: `${originShort} → ${destShort}`,  mono: false },
            ] as const).map(row => (
              <div
                key={row.label}
                className="flex justify-between items-center py-[6px] border-b border-outline-v/20 text-[13px]"
              >
                <span className="text-[11px] text-on-surf-v">{row.label}</span>
                <span
                  className={
                    row.mono
                      ? 'tabular-nums tracking-[0.05em] font-[500] text-on-surf'
                      : 'font-[500] text-on-surf'
                  }
                >
                  {row.value}
                </span>
              </div>
            ))}
            {sealNumber && (
              <div className="flex justify-between items-center pt-[6px] text-[13px]">
                <span className="text-[11px] text-on-surf-v">Seal</span>
                <span className="font-mono tracking-[0.06em] font-[700] text-[13px] bg-primary text-white rounded-sm px-[10px] py-[3px]">
                  {sealNumber}
                </span>
              </div>
            )}
          </div>

          {/* CARGO */}
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
            Cargo
          </div>
          <div className="bg-surf-lowest rounded-md p-[10px_12px] mb-4 text-[13px] shadow-level-2">
            <div className="font-[600] text-on-surf">{parcelCount} parcels</div>
            {loadingHs?.status === 'completed' && (
              <div className="text-[11px] text-ok mt-[3px] flex items-center gap-1">
                <Ic n="check" s={11} className="text-ok" />
                All scanned out at origin ✓
              </div>
            )}
          </div>

          {/* BLOCKCHAIN */}
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-2">
            Blockchain
          </div>
          <div className="bg-chain-c rounded-md p-[10px_12px] mb-4 leading-relaxed">
            <div className="flex items-center gap-[5px] mb-1">
              <Ic n="hex" s={12} className="text-chain" />
              <span className="text-[11px] font-[500] tracking-[0.04em] text-chain-onc">
                {anchoredCount} of {sortedHandshakes.length + 1} receipts anchored
              </span>
            </div>
            {trip.blockchain_receipts.slice(0, 3).map(r => (
              <div key={r.id} className="text-[11px] tracking-[0.03em] text-chain truncate">
                {r.hedera_topic_id} #{r.hedera_sequence_number}
              </div>
            ))}
          </div>

          {/* HOLD TRIP */}
          <Button
            variant="secondary"
            full
            size="sm"
            iconLeft={<Ic n="warn" s={13} className="text-warn" />}
          >
            Hold Trip
          </Button>
        </div>
      </div>
    </div>
  )
}
