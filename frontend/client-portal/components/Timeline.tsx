'use client'

import { formatSast } from '@/lib/format'
import type { TimelineItem } from '@/lib/timeline'
import { TierBadge } from './TierBadge'

interface Props {
  items: TimelineItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function dotClass(item: TimelineItem): string {
  if (item.pending) return 'border-2 border-outline-v bg-surf-lowest'
  if (item.kind === 'exception') return item.critical ? 'bg-err' : 'bg-warn'
  if (item.kind === 'checkpoint') return 'bg-sec'
  return item.tier === 'anchored' ? 'bg-chain' : 'bg-ink'
}

export function Timeline({ items, selectedId, onSelect }: Props) {
  return (
    <ol aria-label="Trip timeline" className="relative space-y-1 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-outline-v">
      {items.map((item) => {
        const selected = item.id === selectedId
        return (
          <li key={`${item.kind}-${item.id}`} className="relative pl-7">
            <span aria-hidden className={`absolute left-[4px] top-3 h-[11px] w-[11px] rounded-full ${dotClass(item)}`} />
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(item.id)}
              className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${selected ? 'bg-sec-c' : 'hover:bg-surf-low'}`}
            >
              <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className={`text-[13px] font-semibold ${item.pending ? 'text-muted' : ''}`}>{item.title}</span>
                <TierBadge tier={item.tier} />
              </span>
              <span className="num mt-0.5 block text-[11px] text-muted">
                {item.pending ? 'Not completed' : formatSast(item.at)}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
