'use client'

import type { Basis } from '@shared/lib/types/analytics-chat'
import { CHAT_COPY, basisDetail } from './chatCopy'

interface BasisLineProps {
  basis: Basis
  /** Opens the basis's tab with the answer's exact dates, so the figure can be checked. */
  onOpen: (basis: Basis) => void
}

/** One "Based on" line under an answer. Built by the server from the tools that ran, so it
 *  is shown as it arrives, never reworded. The headline tiles sit above the tabs, so their
 *  line has nothing to open. */
export function BasisLine({ basis, onOpen }: BasisLineProps) {
  return (
    <p className="text-[11px] leading-snug text-on-surf-v">
      <span className="font-[600]">{CHAT_COPY.basedOn}</span>{' '}
      {basis.tab === null ? (
        <span className="font-[600] text-on-surf">{basis.label}</span>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(basis)}
          aria-label={CHAT_COPY.openTab(basis.label)}
          className="font-[600] text-sec underline underline-offset-2 hover:brightness-110"
        >
          {basis.label}
        </button>
      )}
      {basis.tab !== null && <> · {basisDetail(basis)}</>}
    </p>
  )
}
