import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import type { BlockchainReceipt as BlockchainReceiptType } from '@shared/lib/types/trip'
import { TimestampWithIcon } from './TimestampWithIcon'

interface BlockchainReceiptProps {
  receipt: BlockchainReceiptType
}

export function BlockchainReceipt({ receipt }: BlockchainReceiptProps) {
  const hashScanUrl = `https://hashscan.io/testnet/topic/${receipt.hedera_topic_id}/message/${receipt.hedera_sequence_number}`

  return (
    <Card variant="section" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <Chip type="complete" label={receipt.receipt_type.replace('_', ' ')} />
        <a
          href={hashScanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-secondary hover:underline font-medium"
        >
          View on HashScan
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">SHA-256</p>
          <p className="font-mono tracking-[0.05em] font-bold text-xs text-surface-on break-all mt-0.5">
            {receipt.sha256_hash}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Topic</p>
            <p className="font-mono tracking-[0.05em] font-bold text-xs text-surface-on mt-0.5">
              {receipt.hedera_topic_id}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">Sequence</p>
            <p className="font-mono tracking-[0.05em] font-bold text-xs text-surface-on mt-0.5">
              #{receipt.hedera_sequence_number}
            </p>
          </div>
        </div>
        {receipt.confirmed_at && (
          <TimestampWithIcon timestamp={receipt.confirmed_at} className="text-xs" />
        )}
      </div>
    </Card>
  )
}
