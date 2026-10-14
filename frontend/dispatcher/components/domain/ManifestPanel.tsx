'use client'

import { Button } from '@/components/ui/Button'
import { ManifestContent } from './ManifestContent'

interface Props {
  tripId: string
  heading: string
  width: number
  /** Retained for existing callers; resizing is now owned by the surrounding layout. */
  onStartResize: (e: React.MouseEvent) => void
  onClose: () => void
}

export function ManifestPanel({ tripId, heading, width, onClose }: Props): React.JSX.Element {
  return (
    <section aria-label={heading} className="min-w-0 shrink-0 overflow-y-auto border-l border-outline-v/20 bg-surf-low p-5" style={{ width, maxWidth: '100%' }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-on-surf-v">{heading}</h2>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
      <ManifestContent tripId={tripId} />
    </section>
  )
}
