// frontend/driver-pwa/components/blockchain/AnchorBadge.tsx
//
// driver-pwa-local — NOT a shared component. frontend/shared/components/blockchain/*
// (used by dispatcher) is a separate surface with its own audience and design needs;
// this one is scoped to the driver's one-handed, 360px-wide screen.
import { Chip } from '@/components/ui/Chip'

interface AnchorBadgeProps {
  eventHash: string | null
  receiptId: string | null
  className?: string
}

const HASH_PREFIX_LEN = 8
const HASH_SUFFIX_LEN = 8

// Truncates a 64-char SHA-256 event hash to "first8…last8" for compact display. The
// full hash is never lost — it's still available via the title tooltip and an
// sr-only span, so truncation never hides evidence a driver or auditor might need.
function truncateHash(hash: string): string {
  if (hash.length <= HASH_PREFIX_LEN + HASH_SUFFIX_LEN) return hash
  return `${hash.slice(0, HASH_PREFIX_LEN)}…${hash.slice(-HASH_SUFFIX_LEN)}`
}

// Driver-facing surface for the backend's Hedera HCS anchoring of H2 (Loading) and H5
// (Unloading) — the only two handshakes the backend anchors (H1/H3/H4 are unanchored
// "feeder" handshakes by design). Built on the existing Chip's verified/pending kinds
// rather than inventing new visual states:
//   - eventHash + receiptId both present  -> "Anchored"    (kind="verified")
//   - eventHash present, receiptId absent -> "Anchoring…"  (kind="pending" — hash is
//     captured but the Hedera receipt hasn't come back yet)
//   - eventHash absent                    -> renders nothing (feeder handshake, or
//     this handshake hasn't completed yet — a "pending" chip here would wrongly imply
//     something is in flight when nothing has been submitted at all)
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
