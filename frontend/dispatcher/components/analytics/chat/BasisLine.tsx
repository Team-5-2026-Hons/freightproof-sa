'use client'

import type { Basis } from '@shared/lib/types/analytics-chat'
import { CHAT_COPY, basisDetail } from './chatCopy'

interface BasisLineProps {
  basis: Basis
  /** Opens the basis's tab with the answer's exact dates, so the figure can be checked. */
  onOpen: (basis: Basis) => void
}

/** One "Based on" chip under an answer: the tab (a link to it, with the answer's dates), then the
 *  dates, View by and trip count. Built by the server from the tools that ran, so it is shown as
 *  it arrives, never reworded. The headline tiles sit above the tabs, so their chip has nothing
 *  to open. */
export function BasisLine({ basis, onOpen }: BasisLineProps) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-md border border-outline-v/40 bg-surf-lowest px-2 py-0.5 text-[11px] leading-snug text-on-surf-v">
      {basis.tab === null ? (
        <span className="font-[600] text-on-surf">{basis.label}</span>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(basis)}
          aria-label={CHAT_COPY.openTab(basis.label)}
          className="font-[600] text-sec hover:underline hover:underline-offset-2"
        >
          {basis.label}
        </button>
      )}
      {basis.tab !== null && <span>· {basisDetail(basis)}</span>}
    </span>
  )
}
