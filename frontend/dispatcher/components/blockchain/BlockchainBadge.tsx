'use client'

// Renders a compact Hedera anchor badge linking to HashScan when anchored,
// or a muted state pill when unanchored. Uses the chain tonal palette from the design system.
// "anchored" is the ChainTag pattern (§7.6): chain-c bg, hex icon, on-chain-c text.

import { Ic } from '@/components/ui/Ic'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

type BadgeState = 'anchored' | 'pending' | 'failed' | 'unanchored'

type Props = {
  receipt: BlockchainReceipt | null
  state?: BadgeState
  className?: string
}

const HASHSCAN_BASE =
  process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? 'https://hashscan.io/testnet'

export function BlockchainBadge({ receipt, state, className = '' }: Props) {
  const resolvedState: BadgeState = state ?? (receipt ? 'anchored' : 'unanchored')

  if (resolvedState === 'anchored' && receipt && receipt.hedera_topic_id) {
    const hashscanUrl =
      `${HASHSCAN_BASE}/topic/${receipt.hedera_topic_id}`
    return (
      <a
        href={hashscanUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-[5px] rounded-[var(--r-sm)] bg-chain-c px-[10px] py-[5px] transition-opacity hover:opacity-80 ${className}`}
      >
        <Ic n="hex" s={12} className="text-chain shrink-0" />
        <span className="text-[11px] font-[500] tracking-[0.04em] tabular-nums text-chain-onc">
          Hedera · seq #{receipt.hedera_sequence_number}
        </span>
        <Ic n="eye" s={11} className="text-chain opacity-60 shrink-0" />
      </a>
    )
  }

  if (resolvedState === 'pending') {
    return (
      <span className={`inline-flex items-center gap-[5px] rounded-[var(--r-sm)] bg-sec-c px-[10px] py-[5px] ${className}`}>
        <span className="text-[11px] font-[500] tracking-[0.04em] text-on-sec-c">Anchoring…</span>
      </span>
    )
  }

  if (resolvedState === 'failed') {
    return (
      <span className={`inline-flex items-center gap-[5px] rounded-[var(--r-sm)] bg-err-c px-[10px] py-[5px] ${className}`}>
        <Ic n="warn" s={11} className="text-err shrink-0" />
        <span className="text-[11px] font-[500] tracking-[0.04em] text-on-err-c">Anchor failed</span>
      </span>
    )
  }

  // unanchored
  return (
    <span className={`inline-flex items-center rounded-[var(--r-sm)] bg-surf-high px-[10px] py-[5px] ${className}`}>
      <span className="text-[11px] font-[500] tracking-[0.04em] text-on-surf-v">Not anchored</span>
    </span>
  )
}
