'use client'

import { AlertTriangle } from 'lucide-react'

interface EvidenceItem {
  label: string
  value: string | null
  isImage?: boolean
}

interface EvidenceReviewProps {
  items: EvidenceItem[]
}

export function EvidenceReview({ items }: EvidenceReviewProps) {
  return (
    // Same grouped-card treatment as the trip timeline and the linehaul sheet: one raised
    // surface, no outline, type roles from the shared scale.
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-level-2">
      <p className="text-headline">Evidence collected</p>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <p className="text-footnote font-semibold text-surface-on-variant">{item.label}</p>
          {item.isImage && item.value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.value} alt={item.label} className="max-h-24 w-full rounded-xl object-cover" />
          ) : item.value ? (
            <p className="font-mono text-body tabular-nums text-surface-on">{item.value}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-body font-medium text-error">
              <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden />
              Missing
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
