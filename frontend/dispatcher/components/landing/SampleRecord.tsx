import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

const SAMPLE_RECORD = {
  trip: 'FP-0418',
  route: 'Cape Town → Johannesburg',
  rows: [
    ['Driver', 'Verified · company device'],
    ['Vehicle', 'Horse + 2 trailers'],
    ['Consignments', '3 clients · 412 units'],
    ['Precincts', 'Origin, 1 hub, destination'],
  ],
  fingerprint: '9f2c 41ab 77e0 c8d2 … 51e9 3d1a',
  ledger: 'Hedera Consensus Service',
  recorded: '06:12 SAST',
} as const

interface SampleRecordProps {
  className?: string
  style?: CSSProperties
}

/** The sample journey-lock record, shown in the journey intro: what the first checkpoint seals. */
export function SampleRecord({ className, style }: SampleRecordProps) {
  return (
    <figure
      className={cn('relative rounded-xl border border-outline-v/40 bg-surf-lowest p-6 shadow-level-4 md:p-7', className)}
      style={style}
      aria-label="Sample journey-lock record"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[1.375rem] font-bold tracking-[-0.01em] text-on-surf">Trip {SAMPLE_RECORD.trip}</p>
          <p className="mt-1 text-[0.875rem] text-on-surf-v">{SAMPLE_RECORD.route}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-chain-c px-2 py-1 text-[0.75rem] font-semibold text-chain-onc">
          <Check className="h-3 w-3" strokeWidth={3} />
          Anchored
        </span>
      </div>

      <dl className="mt-6 divide-y divide-outline-v/30 border-y border-outline-v/30">
        {SAMPLE_RECORD.rows.map(([term, detail]) => (
          <div key={term} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
            <dt className="text-[0.8125rem] text-on-surf-v">{term}</dt>
            <dd className="ml-auto text-right text-[0.875rem] font-medium text-on-surf">{detail}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <p className="text-[0.8125rem] text-on-surf-v">Journey lock · SHA-256</p>
        <p className="mt-1 break-all text-[0.9375rem] font-semibold tabular-nums tracking-[0.06em] text-chain">
          {SAMPLE_RECORD.fingerprint}
        </p>
        <p className="mt-3 text-[0.8125rem] text-on-surf-v">
          Anchored to {SAMPLE_RECORD.ledger} at <span className="tabular-nums">{SAMPLE_RECORD.recorded}</span>
        </p>
      </div>

      <figcaption className="mt-5 border-t border-dashed border-outline-v/50 pt-3 text-[0.75rem] text-on-surf-v">
        Sample record. Values are illustrative.
      </figcaption>
    </figure>
  )
}
