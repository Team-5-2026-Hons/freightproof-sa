'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }     from '@/components/ui/TopBar'
import { Chip }       from '@/components/ui/Chip'
import { Button }     from '@/components/ui/Button'
import { Spinner }    from '@/components/ui/Spinner'
import { Ic }         from '@/components/ui/Ic'
import { EmptyState } from '@/components/ui/EmptyState'
import { ROUTES }     from '@/lib/constants/routes'
import { useTripDetail }  from '@/lib/hooks/useTripDetail'
import { usePrecincts }   from '@/lib/hooks/usePrecincts'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { HANDSHAKE_NAMES }  from '@shared/lib/constants/handshake-meta'
import { VerifyButton }       from '@/components/blockchain/VerifyButton'
import { TripCreatedDetail }  from '@/components/domain/TripCreatedDetail'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import type { Trip } from '@shared/lib/types/trip'
import type { BlockchainReceipt, BlockchainReceiptType, VerifyResult } from '@shared/lib/types/blockchain'

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
        <span className="font-mono text-[10px] tracking-[0.04em] text-chain-onc/80 tabular-nums">
          {truncated}
        </span>
        <button
          onClick={copyHash}
          className="text-[9px] font-[500] text-chain-onc/50 hover:text-chain-onc transition-colors"
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
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
}

function fmtTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

function TimelineEvent({
  nodeType, nodeLabel, isLast,
  label, meta, detail, timestamp,
  chainReceipt, excText, resText, expandedContent,
}: TimelineEventProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isExpandable = !!expandedContent

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
          className={`rounded-lg px-4 py-3 ${cardStyle[nodeType]} ${isExpandable ? 'cursor-pointer transition-shadow duration-150 hover:shadow-md active:shadow-sm select-none' : ''}`}
          onClick={isExpandable ? () => setIsExpanded(e => !e) : undefined}
        >
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
          {chainReceipt && <ChainReceiptTag receipt={chainReceipt} />}
          {isExpanded && expandedContent}
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
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  const backButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => router.push(ROUTES.home)}
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

  const statusMeta     = TRIP_STATUS_META[trip.status]
  const originPrecinct = precincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = precincts.find(p => p.id === trip.destination_precinct_id)

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  const sealNumber = trip.handshakes.find(h => h.seal_number)?.seal_number

  const activeHsNum = ACTIVE_HS_FOR_STATUS[trip.status]

  const allSorted = [...trip.handshakes].sort((a, b) => a.sequence_number - b.sequence_number)
  const tripCreationHs = allSorted.find(h => h.sequence_number === 0)
  const sortedHandshakes = allSorted.filter(h => h.sequence_number > 0)

  const loadingHs = sortedHandshakes.find(h => h.sequence_number === 2)
  // Parcel count: prefer the loading handshake scan count; 0 until loading is completed
  const parcelCount = loadingHs?.parcel_count_origin ?? 0

  const anchoredCount = trip.blockchain_receipts.length

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


  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title={trip.trip_reference}
        sub={`${trip.order_number} · ${originShort} → ${destShort} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'}`}
        left={backButton}
      >
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
        {false && <Button variant="secondary" size="sm" iconLeft={<Ic n="file" s={13} className="text-on-surf" />}>Add Note</Button>}
        {false && <Button size="sm" iconLeft={<Ic n="dl" s={13} className="text-white" />}>Export Evidence PDF</Button>}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Timeline ── */}
        <div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">

          <TimelineEvent
            nodeType="done"
            nodeLabel="0"
            isLast={sortedHandshakes.length === 0}
            label="Trip Created"
            meta="Dispatcher"
            detail={`${trip.order_number} · ${trip.driver?.full_name ?? '—'} · ${trip.horse?.registration ?? '—'} · ${parcelCount} parcels`}
            timestamp={tripCreationHs?.completed_at ?? trip.created_at}
            chainReceipt={trip.blockchain_receipts[0]}
            expandedContent={<TripCreatedDetail trip={trip} />}
          />

          {timelineItems.map((item, idx) => {
            const hs     = sortedHandshakes[idx]
            const hsName = HANDSHAKE_NAMES[hs.sequence_number as HandshakeNumber]
            const isLastItem = idx === timelineItems.length - 1

            const locationPart = hs.sequence_number <= 3 ? originShort : destShort
            const meta = hs.completed_at
              ? locationPart
              : item.nodeType === 'active' ? 'In progress'
              : item.nodeType === 'warn'   ? 'Exception'
              : 'Pending'

            const detailParts: string[] = []
            if (hs.pulsit_geofence_confirmed === true)  detailParts.push('Pulsit geofence confirmed ✓')
            if (hs.pulsit_geofence_confirmed === false)  detailParts.push('Pulsit geofence mismatch ✗')
            if (hs.parcel_count_origin !== null)  detailParts.push(`${hs.parcel_count_origin} parcels`)
            if (hs.seal_number)                   detailParts.push(`Seal ${hs.seal_number}`)
            const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined

            const linkedReceipt = hs.blockchain_receipt_id
              ? trip.blockchain_receipts.find(r => r.id === hs.blockchain_receipt_id)
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
                  chainReceipt={linkedReceipt}
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

        {/* ── RIGHT: Sidebar ── */}
        <div className="w-[256px] bg-surf-low p-5 overflow-y-auto shrink-0 border-l border-outline-v/20">

          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Trip Info
          </div>
          <div className="bg-surf-lowest rounded-lg p-[12px_14px] mb-4 shadow-level-2">
            {([
              { label: 'Order',       value: trip.order_number,             mono: true  },
              { label: 'Driver',      value: trip.driver?.full_name ?? '—', mono: false },
              { label: 'Horse',       value: trip.horse?.registration ?? '—', mono: true },
              { label: 'Origin',      value: originShort,                   mono: false },
              { label: 'Destination', value: destShort,                     mono: false },
            ] as const).map((row, i, arr) => (
              <div
                key={row.label}
                className={`flex justify-between items-start gap-3 py-[8px] text-[13px]${i < arr.length - 1 ? ' border-b border-outline-v/20' : ''}`}
              >
                <span className="text-[11px] text-on-surf-v shrink-0 pt-[1px]">{row.label}</span>
                <span className={`text-right${row.mono ? ' tabular-nums tracking-[0.05em] font-[600] text-on-surf' : ' font-[500] text-on-surf'}`}>
                  {row.value}
                </span>
              </div>
            ))}
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
                <div className="flex items-center gap-[5px] mb-1">
                  <Ic n="hex" s={12} className={iconCl} />
                  <span className={`text-[11px] font-[500] tracking-[0.04em] ${labelCl}`}>
                    {anchoredCount} of {sortedHandshakes.length + 1} receipts anchored
                  </span>
                </div>
                {trip.blockchain_receipts.slice(0, 3).map(r => (
                  <div key={r.id} className={`text-[11px] tracking-[0.03em] truncate tabular-nums ${subCl}`}>
                    {r.hedera_topic_id} #{r.hedera_sequence_number}
                  </div>
                ))}
                <VerifyButton subjectType="trip" subjectId={trip.id as string} autoVerify onResult={setVerifyResult} />
              </div>
            )
          })()}

          {false && (
            <Button variant="secondary" full size="sm" iconLeft={<Ic n="warn" s={13} className="text-warn" />}>
              Hold Trip
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
