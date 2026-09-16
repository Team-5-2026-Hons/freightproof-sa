'use client'

import { useState, useId, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PhaseNodeType } from '@/lib/phase/derive'

// The `id` this component's root `<div>` renders with — built by the caller (see
// TripTimeline.tsx) as `${PHASE_ANCHOR_PREFIX}${phase_event_id}`. Exported as the one
// source of truth so the trip page's `jump()` and hash-scroll effect can't drift from it.
export const PHASE_ANCHOR_PREFIX = 'phase-'

// See PhaseNodeType's doc comment in lib/phase/derive.ts — 'next' is the ledger's
// current gate with nothing done yet, 'active' is genuinely under way.
const NODE_STYLE: Record<PhaseNodeType, string> = {
  done:    'bg-ok text-white',
  active:  'bg-sec text-white animate-pulse',
  next:    'bg-surf-lowest text-sec border-2 border-sec',
  warn:    'bg-warn-c text-warn-onc',
  pending: 'bg-surf-high text-on-surf-v border border-outline-v',
}

// The rail behind a completed phase is green; everything from the current gate onward is neutral.
const LINE_STYLE: Record<PhaseNodeType, string> = {
  done:    'bg-ok/40',
  active:  'bg-outline-v/30',
  next:    'bg-outline-v/30',
  warn:    'bg-outline-v/30',
  pending: 'bg-outline-v/30',
}

const CARD_STYLE: Record<PhaseNodeType, string> = {
  done:    'bg-surf-low',
  active:  'bg-sec-c border border-sec/20',
  // A light outline (vs. `active`'s solid fill) says "waiting on", not "in progress".
  next:    'bg-surf-low border border-sec/30',
  warn:    'bg-warn-c/40 border border-warn/20',
  pending: 'border border-dashed border-outline-v/40',
}

interface Props {
  id: string; label: string; meta: string; summary?: string; timestamp: string | null
  nodeType: PhaseNodeType; number: number; initialOpen: boolean; cancelled: boolean
  overridden: boolean; children?: ReactNode; warning?: string; receipt?: ReactNode
  /** Suppresses the trailing rail so the timeline ends on a node, not a dangling line. */
  isLast: boolean
  /** Renders the evidence unconditionally and drops the toggle — for a phase still in progress. */
  alwaysOpen?: boolean
  /** Compact recorded-location verdict, shown in the summary area so it reads without expanding the card. */
  evidenceSummary?: ReactNode
  /** Content rendered OUTSIDE the toggle, always visible whether or not the card is
   *  open — for a fact (a transit leg's departure/arrival, task 9) that must survive
   *  collapse the way `evidenceSummary` does, but is too substantial to squeeze into
   *  the summary row itself. Sits between the summary and the disclosed `children`. */
  persistentContent?: ReactNode
}

export function PhaseTimelineItem({
  id, label, meta, summary, timestamp, nodeType, number, initialOpen, cancelled,
  overridden, children, warning, receipt, isLast, alwaysOpen = false, evidenceSummary,
  persistentContent,
}: Props) {
  const [open, setOpen] = useState(initialOpen)
  const contentId = useId()
  // An always-open card has nothing to toggle, so it gets no chevron either.
  const expandable = !!children && !alwaysOpen
  const status = overridden ? 'Unable to complete' : cancelled && (nodeType === 'next' || nodeType === 'pending') ? 'Not reached'
    : nodeType === 'warn' ? 'Exception' : nodeType === 'active' ? 'In progress' : nodeType === 'next' ? 'Current phase' : nodeType === 'pending' ? 'Not started' : null

  const summaryContent = <>
    <div className="mb-[5px] flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
        <h3 className={`text-[15px] font-[700] leading-snug ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>{label}</h3>
        {status && <Chip type={nodeType === 'warn' ? 'exception' : 'pending'} label={status} />}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        {timestamp && <time dateTime={timestamp} className="flex items-center gap-[4px] text-[12px] font-[700] tabular-nums text-sec">
          <Ic n="clock" s={11} className="text-sec" />{fmtDateTime(timestamp)}
        </time>}
        {/* Absence is load-bearing: no chevron means nothing to open. Rotated when open. */}
        {expandable && <Ic n="chev" s={14} aria-hidden className={`text-on-surf-v transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />}
      </div>
    </div>
    {meta && <div className="mb-[6px] text-[11px] font-[500] text-on-surf-v">{meta}</div>}
    {summary && <div className="mt-1 text-[13px] text-on-surf-v">{summary}</div>}
    {/* Chip + separation only, no interactive content — safe to nest in the toggle <button> below. */}
    {evidenceSummary && <div className="mt-[6px]">{evidenceSummary}</div>}
  </>

  return <div id={id} className="relative flex min-w-0 scroll-mt-4 gap-[14px]">
    <div className="flex shrink-0 flex-col items-center">
      <div className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-[700] ${NODE_STYLE[nodeType]}`}>
        {nodeType === 'done' && !overridden ? <Ic n="check" s={14} className="text-white" aria-hidden /> : number}
      </div>
      {!isLast && <div className={`my-1 min-h-[20px] w-0.5 flex-1 ${LINE_STYLE[nodeType]}`} />}
    </div>
    {/* Same bottom gap on every row; the rail is a sibling stretching the row's full height. */}
    <div className="mb-3 min-w-0 flex-1">
      <div className={`rounded-lg px-4 py-3 ${CARD_STYLE[nodeType]} ${expandable ? 'transition-shadow duration-150 hover:shadow-md' : ''}`}>
        {/* Wraps the summary only — interactive content (Copy buttons, thumbnails) can't nest inside a <button>. */}
        {expandable ? <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className="block w-full select-none rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">{summaryContent}</button> : summaryContent}
        {persistentContent && <div>{persistentContent}</div>}
        {warning && <p className="mt-3 text-[13px] font-[600] text-warn">{warning}</p>}
        {receipt}
        {children && (alwaysOpen || open) && <div id={alwaysOpen ? undefined : contentId}>{children}</div>}
      </div>
    </div>
  </div>
}
