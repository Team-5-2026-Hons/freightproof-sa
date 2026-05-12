'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface TripIdStampProps {
  tripReference: string
  className?: string
}

/**
 * Trip reference displayed in monospace-like style with copy-to-clipboard on hover.
 * Uses Inter with wide tracking per DESIGN_SYSTEM.md §3 mono-id role.
 */
export function TripIdStamp({ tripReference, className }: TripIdStampProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tripReference)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      aria-label={`Copy trip ID ${tripReference}`}
      className={cn(
        'inline-flex items-center gap-1.5 group',
        'font-mono tracking-[0.05em] font-bold text-sm text-surface-on',
        'hover:text-secondary transition-colors duration-150',
        className,
      )}
    >
      {tripReference}
      {copied ? (
        <Check className="w-3.5 h-3.5 text-success" />
      ) : (
        <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      )}
    </button>
  )
}
