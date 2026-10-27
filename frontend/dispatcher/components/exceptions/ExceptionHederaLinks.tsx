'use client'
import { ForensicOnly } from '@/components/blockchain/ForensicOnly'
import { hashscanTopicUrl, isAnchoredTopic } from '@/lib/format/hashscan'
import type { EvidenceAnchorSummary } from '@shared/lib/types/exception'
import type { BlockchainReceiptType } from '@shared/lib/types/blockchain'

const ACTION_LABELS: Partial<Record<BlockchainReceiptType, string>> = {
  exception_raised: 'Raised',
  exception_reviewed: 'Reviewed',
  trip_cancelled: 'Trip cancelled',
}

interface HederaLink { eventId: string; label: string; sequence: number; href: string }

function linkOf(event: EvidenceAnchorSummary): HederaLink | null {
  const topic = event.hedera_topic_id
  const sequence = event.hedera_sequence_number
  if (!isAnchoredTopic(topic) || sequence == null) return null
  return {
    eventId: event.event_id,
    label: ACTION_LABELS[event.receipt_type] ?? 'Exception action',
    sequence,
    href: hashscanTopicUrl(topic),
  }
}

/** One HashScan link per exception action that has reached Hedera. Pending and failed
 *  events show nothing: retry is automatic and the dispatcher cannot act on it. */
export function ExceptionHederaLinks({ events }: { events: EvidenceAnchorSummary[] }) {
  const links = events.map(linkOf).filter((l): l is HederaLink => l !== null)
  if (links.length === 0) return null
  return <ForensicOnly>
    <div className="mt-6 border-t border-outline-v/30 pt-4 text-sm text-on-surf-v">
      <h2 className="mb-3 text-base font-semibold text-on-surf">Hedera records</h2>
      <ul className="flex flex-col gap-2">
        {links.map(link => <li key={link.eventId} className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-on-surf">{link.label}</span>
          <span className="tabular-nums">seq #{link.sequence}</span>
          <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} on HashScan`} className="font-semibold text-chain hover:underline">HashScan ↗</a>
        </li>)}
      </ul>
    </div>
  </ForensicOnly>
}
