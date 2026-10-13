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
  id: string; label: string; meta: string; timestamp: string | null
  nodeType: PhaseNodeType; number: number; initialOpen: boolean; cancelled: boolean
  overridden: boolean; children?: ReactNode; warning?: string
  /** Suppresses the trailing rail so the timeline ends on a node, not a dangling line. */
  isLast: boolean
  /** Renders the body unconditionally and drops the toggle: the in-transit leg, which is where
   *  theft signals arrive and is never worth hiding. */
  alwaysOpen?: boolean
  /** The header's answer to "did this phase go cleanly?": icon, word and reasons. When present
   *  it says what the old status chip said (Exception, Unable to complete, In progress), so the
   *  chip is dropped; a card with no verdict (not started, not reached) keeps its chip.
   *  Text only, so it is safe to nest inside the toggle button. */
  verdict?: ReactNode
  /** Shown only while the card is collapsed, under the verdict and outside the toggle (it holds
   *  buttons). A closed card must never hide an exception; open, the same rows live in the rail. */
  collapsedContent?: ReactNode
  /** A request counter: each new value opens the card (a page-originated "Show in timeline"). */
  openRequestId?: number | null
}

/** The chip a card with no verdict wears. */
function statusChip(nodeType: PhaseNodeType, cancelled: boolean, overridden: boolean): string | null {
  if (overridden) return 'Unable to complete'
  if (cancelled && (nodeType === 'next' || nodeType === 'pending')) return 'Not reached'
  if (nodeType === 'warn') return 'Exception'
  if (nodeType === 'active') return 'In progress'
  if (nodeType === 'next') return 'Current phase'
  return nodeType === 'pending' ? 'Not started' : null
}

export function PhaseTimelineItem({
  id, label, meta, timestamp, nodeType, number, initialOpen, cancelled,
  overridden, children, warning, isLast, alwaysOpen = false, verdict, collapsedContent, openRequestId = null,
}: Props) {
  const [open, setOpen] = useState(initialOpen)
  // Adjusting state during render, not in an effect: React's own pattern for reacting to a changed
  // prop, so the card opens in the same pass that delivers the request.
  const [seenRequest, setSeenRequest] = useState<number | null>(null)
  if (openRequestId !== seenRequest) {
    setSeenRequest(openRequestId)
    if (openRequestId !== null) setOpen(true)
  }
  const contentId = useId()
  // An always-open card has nothing to toggle, so it gets no chevron either.
  const expandable = !!children && !alwaysOpen
  const status = verdict ? null : statusChip(nodeType, cancelled, overridden)

  const summaryContent = <>
    <div className="mb-[5px] flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
        <h3 className={`text-title ${nodeType === 'pending' ? 'text-on-surf-v' : 'text-on-surf'}`}>{label}</h3>
        {status && <Chip type={nodeType === 'warn' ? 'exception' : 'pending'} label={status} />}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        {timestamp && <time dateTime={timestamp} className="flex items-center gap-[4px] text-meta font-bold tabular-nums text-sec">
          <Ic n="clock" s={11} className="text-sec" />{fmtDateTime(timestamp)}
        </time>}
        {/* Absence is load-bearing: no chevron means nothing to open. Rotated when open. */}
        {expandable && <Ic n="chev" s={14} className={`text-on-surf-v transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />}
      </div>
    </div>
    {meta && <div className="text-label font-medium text-on-surf-v">{meta}</div>}
    {verdict}
  </>

  return <div id={id} className="relative flex min-w-0 scroll-mt-4 gap-[14px]">
    <div className="flex shrink-0 flex-col items-center">
      <div data-node-type={nodeType} className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-meta font-bold ${NODE_STYLE[nodeType]}`}>
        {nodeType === 'done' && !overridden ? <Ic n="check" s={14} className="text-white" /> : number}
      </div>
      {!isLast && <div className={`my-1 min-h-[20px] w-0.5 flex-1 ${LINE_STYLE[nodeType]}`} />}
    </div>
    {/* Same bottom gap on every row; the rail is a sibling stretching the row's full height. */}
    <div className="mb-3 min-w-0 flex-1">
      <div className={`rounded-lg px-4 py-3 ${CARD_STYLE[nodeType]} ${expandable ? 'transition-shadow duration-150 hover:shadow-md' : ''}`}>
        {/* Wraps the header only: buttons (exception rows, thumbnails, Copy) cannot nest inside a <button>. */}
        {expandable ? <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className="block w-full select-none rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">{summaryContent}</button> : summaryContent}
        {!open && !alwaysOpen && collapsedContent}
        {warning && <p className="mt-3 text-body font-semibold text-warn">{warning}</p>}
        {children && (alwaysOpen || open) && <div id={alwaysOpen ? undefined : contentId}>{children}</div>}
      </div>
    </div>
  </div>
}
