// driver-pwa-local, not shared: frontend/shared/components/blockchain/* (dispatcher) is
// a separate surface; this one is scoped to the driver's one-handed, 360px-wide screen.
import { Chip } from '@/components/ui/Chip'

interface AnchorBadgeProps {
  eventHash: string | null
  receiptId: string | null
  className?: string
}

const HASH_PREFIX_LEN = 8
const HASH_SUFFIX_LEN = 8

// Truncates a 64-char SHA-256 event hash to "first8…last8"; the full hash stays
// available via the title tooltip and an sr-only span.
function truncateHash(hash: string): string {
  if (hash.length <= HASH_PREFIX_LEN + HASH_SUFFIX_LEN) return hash
  return `${hash.slice(0, HASH_PREFIX_LEN)}…${hash.slice(-HASH_SUFFIX_LEN)}`
}

// Driver-facing surface for the backend's Hedera HCS anchoring of H2 (Loading) and H5
// (Unloading) — the only two anchored handshakes. Renders nothing when eventHash is
// absent, since a "pending" chip would wrongly imply something is in flight.
export function AnchorBadge({ eventHash, receiptId, className }: AnchorBadgeProps) {
  if (!eventHash) return null

  const truncated = truncateHash(eventHash)

  if (!receiptId) {
    return (
      <Chip kind="pending" className={className} title={`Anchoring to Hedera HCS — event hash ${truncated}`}>
        Anchoring…
        <span className="sr-only"> Event hash {truncated}</span>
      </Chip>
    )
  }

  return (
    <Chip kind="verified" className={className} title={`Anchored to Hedera HCS — event hash ${truncated}`}>
      Anchored
      <span className="sr-only"> Event hash {truncated}</span>
    </Chip>
  )
}
