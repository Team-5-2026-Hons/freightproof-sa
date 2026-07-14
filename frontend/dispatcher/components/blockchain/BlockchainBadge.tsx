'use client'

// Renders a Hedera anchor badge: plain-language verification state for every dispatcher
// in forensic mode, with the technical detail (hash, seq #, HashScan link) visible
// underneath for anyone who wants to manually cross-check the on-chain message.
// Uses the chain tonal palette from the design system (§7.6: chain-c bg, hex icon, on-chain-c text).

import { useState } from 'react'
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

function truncateHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash
}

export function BlockchainBadge({ receipt, state, className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const resolvedState: BadgeState = state ?? (receipt ? 'anchored' : 'unanchored')

  function copyHash() {
    if (!receipt) return
    navigator.clipboard.writeText(receipt.data_hash).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (resolvedState === 'anchored' && receipt && receipt.hedera_topic_id) {
    const hashscanUrl = `${HASHSCAN_BASE}/topic/${receipt.hedera_topic_id}`
    return (
      <div className={`rounded-[var(--r-sm)] bg-chain-c px-[10px] py-[7px] ${className}`}>
        <div className="flex items-center gap-[5px]">
          <Ic n="check" s={12} className="text-chain shrink-0" />
          <span className="text-[11px] font-[600] tracking-[0.04em] text-chain-onc">
            Verified on blockchain
          </span>
        </div>
        <div className="flex items-center gap-[6px] mt-[4px]">
          <span className="font-mono text-[10px] tracking-[0.04em] text-chain-onc/80 tabular-nums flex-1">
            {truncateHash(receipt.data_hash)}
          </span>
          <button
            onClick={copyHash}
            className="shrink-0 inline-flex items-center rounded px-[6px] py-[2px] text-[9px] font-[600] bg-chain-onc/15 text-chain-onc hover:bg-chain-onc/30 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <a
            href={hashscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-[3px] rounded px-[6px] py-[2px] text-[9px] font-[600] bg-chain-onc/15 text-chain-onc hover:bg-chain-onc/30 transition-colors"
          >
            Hedera · seq #{receipt.hedera_sequence_number} ↗
          </a>
        </div>
      </div>
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
      <span className="text-[11px] font-[500] tracking-[0.04em] text-on-surf-v">
        Not verified — minor change, skipped anchoring
      </span>
    </span>
  )
}
