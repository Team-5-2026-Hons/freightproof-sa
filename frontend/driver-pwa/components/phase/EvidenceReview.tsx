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
    <div className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
      <p className="text-sm font-semibold">Evidence collected</p>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <p className="text-xs text-surface-on-variant">{item.label}</p>
          {item.isImage && item.value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.value} alt={item.label} className="max-h-24 w-full rounded-lg object-cover" />
          ) : item.value ? (
            <p className="text-sm font-medium text-surface-on">{item.value}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-medium text-error">
              <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden />
              Missing
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
