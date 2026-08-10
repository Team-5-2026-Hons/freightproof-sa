'use client'

// Renders a small Hedera anchor badge linking to HashScan when anchored,
// or a muted state pill when pending / failed / unanchored.
// Used in trip detail headers, vehicle/driver history tables, and the event timeline.

import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

type BadgeState = 'anchored' | 'pending' | 'failed' | 'unanchored'

type Props = {
  receipt: BlockchainReceipt | null
  state?: BadgeState
  className?: string
}

// Falls back to Hedera testnet if the env var is absent (e.g. local dev without .env.local).
const HASHSCAN_BASE =
  process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? 'https://hashscan.io/testnet'

export function BlockchainBadge({ receipt, state, className = '' }: Props) {
  const resolvedState: BadgeState = state ?? (receipt ? 'anchored' : 'unanchored')

  if (resolvedState === 'anchored' && receipt && receipt.hedera_topic_id) {
    const hashscanUrl =
      `${HASHSCAN_BASE}/topic/${receipt.hedera_topic_id}/${receipt.hedera_sequence_number}`
    // Prefer the consensus timestamp; fall back to DB created_at when HCS hasn't confirmed yet.
    const ts = receipt.hedera_consensus_timestamp ?? receipt.created_at
    return (
      <a
        href={hashscanUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 ${className}`}
      >
        <span>🔒</span>
        <span>Hedera</span>
        <span className="opacity-70">·</span>
        <span>Seq #{receipt.hedera_sequence_number}</span>
        <span className="opacity-70">·</span>
        <span>{new Date(ts).toUTCString()}</span>
        <span className="opacity-70">↗</span>
      </a>
    )
  }
  if (resolvedState === 'pending') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 ${className}`}>
        <span>⏳</span><span>Anchoring…</span>
      </span>
    )
  }
  if (resolvedState === 'failed') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 ${className}`}>
        <span>⚠</span><span>Anchor failed</span>
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/50 ${className}`}>
      <span>Not anchored</span>
    </span>
  )
}
