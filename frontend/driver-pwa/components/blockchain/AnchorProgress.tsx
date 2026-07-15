// frontend/driver-pwa/components/blockchain/AnchorProgress.tsx
//
// driver-pwa-local — NOT a shared component (see AnchorBadge.tsx for the same
// rationale). AnchorBadge is a one-line summary chip ("Anchored" / "Anchoring…");
// this is a richer sibling for surfaces with room for a 3-row pipeline view — it
// shows WHERE a handshake's evidence sits in the Hedera anchoring pipeline, not
// just whether the whole thing is done.
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AnchorProgressProps {
  eventHash: string | null
  receiptId: string | null
  className?: string
}

const HASH_PREFIX_LEN = 8
const HASH_SUFFIX_LEN = 8

// Truncates a 64-char SHA-256 event hash (or a Hedera receipt id) to "first8…last8"
// for compact display — mirrors AnchorBadge's truncateHash. The full value is never
// lost: it's still available via the title tooltip and an sr-only span, so
// truncation never hides evidence a driver or auditor might need.
function truncateHash(value: string): string {
  if (value.length <= HASH_PREFIX_LEN + HASH_SUFFIX_LEN) return value
  return `${value.slice(0, HASH_PREFIX_LEN)}…${value.slice(-HASH_SUFFIX_LEN)}`
}

// Compact vertical 3-row tracker for where a handshake's evidence sits in the
// backend's Hedera anchoring pipeline (anchor-before-status-flip — by the time a
// completeH2/H5 response returns, event_hash AND blockchain_receipt_id should both
// already be set; a legacy row with event_hash but no receipt stays "in progress"
// forever, which is expected for data predating anchoring). Renders nothing when
// eventHash is null: same rationale as AnchorBadge — nothing has been submitted yet
// (feeder handshake, or this handshake hasn't completed), and showing a pipeline
// here would wrongly imply something is in flight.
export function AnchorProgress({ eventHash, receiptId, className }: AnchorProgressProps) {
  if (!eventHash) return null

  const truncatedHash = truncateHash(eventHash)
  const anchored = receiptId !== null
  const truncatedReceipt = receiptId ? truncateHash(receiptId) : null

  return (
    <ol className={cn('flex flex-col gap-1.5', className)}>
      <li
        className="flex items-center gap-2"
        title={`Event hash ${eventHash}`}
        aria-label={`Evidence hashed — ${truncatedHash}`}
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={2} aria-hidden />
        <span className="text-xs text-surface-on">
          Evidence hashed — {truncatedHash}
          <span className="sr-only"> Full event hash {eventHash}</span>
        </span>
      </li>

      <li
        className="flex items-center gap-2"
        aria-label={`Submitted to Hedera HCS — ${anchored ? 'complete' : 'in progress'}`}
      >
        {anchored ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={2} aria-hidden />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-surface-on-variant" strokeWidth={2} aria-hidden />
        )}
        <span className={cn('text-xs', anchored ? 'text-surface-on' : 'text-surface-on-variant')}>
          Submitted to Hedera HCS
        </span>
      </li>

      <li
        className="flex items-center gap-2"
        title={anchored ? `Blockchain receipt ${receiptId}` : undefined}
        aria-label={anchored ? `Anchor receipt recorded — ${truncatedReceipt}` : 'Anchor receipt recorded — pending'}
      >
        {anchored ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={2} aria-hidden />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-surface-on-variant" strokeWidth={2} aria-hidden />
        )}
        <span className={cn('text-xs', anchored ? 'text-surface-on' : 'text-surface-on-variant')}>
          Anchor receipt recorded{anchored ? ` — ${truncatedReceipt}` : ''}
          {anchored && <span className="sr-only"> Full receipt id {receiptId}</span>}
        </span>
      </li>
    </ol>
  )
}
