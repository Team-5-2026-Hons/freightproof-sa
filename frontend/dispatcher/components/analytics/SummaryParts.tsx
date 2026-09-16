'use client'

// Building blocks for the one-entity analytics summaries on the vehicle and driver detail
// pages: one definition, so both look alike — a dash is always drawn quietly, and severities
// are always three separate figures.

import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { MonthRangePicker } from '@/components/ui/MonthRangePicker'
import { Spinner } from '@/components/ui/Spinner'
import { NO_DATA } from '@/lib/format/analytics'
import type { MonthRange } from '@/lib/types/month-range'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { ExceptionSeverity } from '@shared/lib/types/exception'
import { cn } from '@shared/lib/utils/cn'
import { ANALYTICS_COPY } from './copy'

const FRAME_COPY = {
  // Same wording as DataTable's error state, so a failure reads alike on /analytics.
  loadFailed: 'Failed to load',
  retry: 'Try again',
} as const

// The right panel is already bg-surf-lowest, so tiles take the next tone down.
const TILE_CLASS = 'bg-surf-low rounded-lg'
const DOT_CLASS = 'h-1.5 w-1.5 shrink-0 rounded-full'

const SEVERITY_ORDER = ['info', 'warning', 'critical'] as const satisfies readonly ExceptionSeverity[]

/** Colours for a count strip cell whose count is non-zero. */
export interface CountStyle {
  dot: string
  /** Cell background and text colour. */
  tint?: string
  text?: string
}

// Colours follow each severity's chip, so a severity reads the same here as on an exception
// chip. Info chips are neutral grey, so an info count is marked but not tinted.
const SEVERITY_STYLE: Record<ExceptionSeverity, CountStyle> = {
  info: { dot: 'bg-outline-v' },
  warning: { dot: 'bg-warn', tint: 'bg-warn-c/25', text: 'text-warn' },
  critical: { dot: 'bg-err', tint: 'bg-err-c/40', text: 'text-err' },
}

interface AnalyticsSummaryFrameProps {
  range: MonthRange
  onRangeChange: (range: MonthRange) => void
  isLoading: boolean
  error: string | null
  onRetry: () => void
  /** The figures, shown once loaded without error. */
  children: ReactNode
}

/** Month range picker above a spinner, an error with retry, or the figures. */
export function AnalyticsSummaryFrame({
  range, onRangeChange, isLoading, error, onRetry, children,
}: AnalyticsSummaryFrameProps) {
  let body: ReactNode = children
  if (isLoading) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    )
  } else if (error) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-[13px] font-[600] text-on-surf">{FRAME_COPY.loadFailed}</p>
        <p className="text-[13px] text-on-surf-v">{error}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {FRAME_COPY.retry}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Always shown, so the range can still be changed after an error or an empty result. */}
      <MonthRangePicker value={range} onChange={onRangeChange} />
      {body}
    </div>
  )
}

export function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">{title}</span>
      {detail && <span className="text-[12px] text-on-surf-v">{detail}</span>}
    </div>
  )
}

export function SectionDivider() {
  return <hr className="border-outline-v/40" />
}

/** No row means no closed trips in these months: say so rather than show zeros. */
export function EmptyNote() {
  return (
    <div className={cn(TILE_CLASS, 'p-4')}>
      <p className="text-[13px] font-[600] text-on-surf">{ANALYTICS_COPY.empty.title}</p>
      <p className="mt-1 text-[12px] text-on-surf-v">{ANALYTICS_COPY.empty.body}</p>
    </div>
  )
}

export function StatTiles({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3">{children}</dl>
}

interface StatTileProps {
  label: string
  value: string
  /** The blue lead tile (Trips). */
  accent?: boolean
}

export function StatTile({ label, value, accent = false }: StatTileProps) {
  return (
    <Stat
      label={label} value={value} size="lg" labelAbove
      toneClass={accent ? 'text-sec' : undefined}
      className={cn('rounded-lg p-4', accent ? 'bg-sec-c/40' : 'bg-surf-low')}
    />
  )
}

export interface CountCell {
  label: string
  count: number
  style: CountStyle
}

/** Three counts side by side, each its own figure and never summed. */
export function CountStrip({ cells }: { cells: readonly CountCell[] }) {
  return (
    <dl className={cn(TILE_CLASS, 'grid grid-cols-3 divide-x divide-outline-v/40 overflow-hidden')}>
      {cells.map(({ label, count, style }) => {
        const happened = count > 0
        return (
          <Stat
            key={label}
            label={label}
            value={String(count)}
            // A zero recedes and anything else is coloured, so the eye lands on what happened.
            muted={!happened}
            toneClass={happened ? style.text : undefined}
            dotClass={happened ? style.dot : undefined}
            className={cn('p-4', happened && style.tint)}
          />
        )
      })}
    </dl>
  )
}

/** Info, warning and critical as three separate figures, never summed. */
export function SeverityStrip({ counts }: { counts: Readonly<Record<ExceptionSeverity, number>> }) {
  return (
    <CountStrip
      cells={SEVERITY_ORDER.map((severity) => ({
        label: EXCEPTION_SEVERITY_META[severity].label,
        count: counts[severity],
        style: SEVERITY_STYLE[severity],
      }))}
    />
  )
}

interface DetailRowProps {
  label: string
  value: string
  /** Draw the value quietly. Defaults to true for a dash. */
  quiet?: boolean
}

/** A single label/value line under a tile row or the severity strip. */
export function DetailRow({ label, value, quiet }: DetailRowProps) {
  const isQuiet = quiet ?? value === NO_DATA
  return (
    <dl className="mt-3 px-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <dt className="text-on-surf">{label}</dt>
        <dd className={isQuiet ? 'text-on-surf-v' : 'font-[600] tabular-nums text-on-surf'}>{value}</dd>
      </div>
    </dl>
  )
}

export function ListRows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-outline-v/40">{children}</dl>
}

interface ListRowProps {
  label: string
  value: string
  /** Unit after the figure, e.g. "trips". Left off a dash. */
  unit?: string
  dotClass?: string
  /** Colour for the figure; defaults to the body text colour. */
  figureClass?: string
  /** A caveat that must be read with this figure, printed under its label. */
  note?: string
}

export function ListRow({ label, value, unit, dotClass, figureClass, note }: ListRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      {/* The label stays the <dt>'s own text, so it pairs directly with the <dd>. */}
      <dt className="flex min-w-0 flex-wrap items-center gap-x-3 text-[14px] text-on-surf">
        {dotClass && <span aria-hidden="true" className={cn(DOT_CLASS, dotClass)} />}
        {label}
        {note && <span className="mt-1 basis-full text-[12px] text-on-surf-v">{note}</span>}
      </dt>
      <dd className="shrink-0 text-right">
        {value === NO_DATA ? (
          <span className="text-[14px] text-on-surf-v">{NO_DATA}</span>
        ) : (
          <>
            <span className={cn('text-[18px] font-[700] tabular-nums', figureClass ?? 'text-on-surf')}>
              {value}
            </span>
            {unit && <>{' '}<span className="text-[12px] text-on-surf-v">{unit}</span></>}
          </>
        )}
      </dd>
    </div>
  )
}

interface StatProps {
  label: string
  value: string
  size?: 'md' | 'lg'
  /** Label over the figure (tiles) rather than under it (the severity strip). */
  labelAbove?: boolean
  /** Draw the figure quietly; a dash is always quiet. */
  muted?: boolean
  /** Text colour for the label and figure, e.g. a severity's colour. */
  toneClass?: string
  /** Colour class for a small dot after the figure. */
  dotClass?: string
  className?: string
}

function Stat({ label, value, size = 'md', labelAbove = false, muted = false, toneClass, dotClass, className }: StatProps) {
  const quiet = muted || value === NO_DATA
  return (
    // Label always comes first in the DOM (screen reader hears "Trips, 11"); flex-col-reverse
    // puts the figure on top visually.
    <div className={cn('flex gap-2', labelAbove ? 'flex-col' : 'flex-col-reverse', className)}>
      <dt className={cn('text-[13px]', toneClass ?? 'text-on-surf-v')}>{label}</dt>
      <dd
        className={cn(
          'flex items-center gap-[6px] leading-none tabular-nums tracking-[0.02em]',
          size === 'lg' ? 'text-[28px]' : 'text-[22px]',
          quiet ? 'font-[400] text-on-surf-v' : cn('font-[700]', toneClass ?? 'text-on-surf'),
        )}
      >
        {value}
        {/* Decorative: the label beside it already names what is counted. */}
        {dotClass && <span aria-hidden="true" className={cn(DOT_CLASS, dotClass)} />}
      </dd>
    </div>
  )
}
