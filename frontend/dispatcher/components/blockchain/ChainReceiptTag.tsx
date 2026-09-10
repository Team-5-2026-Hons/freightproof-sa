'use client'
import { useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { fmtFull } from '@shared/lib/utils/datetime'
import type { BlockchainReceipt, BlockchainReceiptType } from '@shared/lib/types/blockchain'
const HASHSCAN_BASE =
  process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? 'https://hashscan.io/testnet'

const RECEIPT_LABELS: Partial<Record<BlockchainReceiptType, string>> = {
  journey_lock:      'Journey lock anchored',
  pickup:            'Pickup receipt anchored',
  delivery:          'Delivery receipt anchored',
  checkpoint_batch:  'Checkpoint receipt anchored',
  exception_batch:   'Exception receipt anchored',
}

export function ChainReceiptTag({ receipt }: { receipt: BlockchainReceipt }) {
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
          Anchored {fmtFull(receipt.hedera_consensus_timestamp)}
        </div>
      )}
    </div>
  )
}

