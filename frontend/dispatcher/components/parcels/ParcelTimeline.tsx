import Link from 'next/link'
import { Fragment, type JSX, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { LinkButton } from '@/components/ui/LinkButton'
import { LINE_STYLE, NODE_STYLE } from '@/components/trips/PhaseTimelineItem'
import type { PhaseNodeType } from '@/lib/phase/derive'
import { fmtDateTime, fmtFull } from '@shared/lib/utils/datetime'
import type { ParcelJourney, ParcelTraceException } from '@shared/lib/types/parcel-trace'
import { ROUTES } from '@/lib/constants/routes'
import { countLabel } from '@/lib/format/count'
import { exceptionDescriptionText, fmtExceptionType } from '@/lib/format/exception'
import { withReturnTo } from '@/lib/navigation/returnTo'
import {
  LOCATION_LABELS, Heading, awaitsReview, hiddenLedgerCounts, locationLabel, notRecordedItems, parcelSteps, reviewStatusLabel, severityLabel,
  tripEvidenceLink, type HeadingLevel, type ParcelStep,
} from './trace-display'

interface Props {
  journey: ParcelJourney
  returnTo: string
  headingLevel?: HeadingLevel
}

const SUMMARY_CLASS = 'flex min-h-11 cursor-pointer list-none items-start gap-2 rounded py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec [&::-webkit-details-marker]:hidden'
const DETAIL_CLASS = 'space-y-3 pb-3 text-xs text-on-surf-v'
const LINK_CLASS = 'inline-flex min-h-11 items-center gap-1 rounded text-xs font-semibold text-sec underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec'
const EXCEPTION_LINE_CLASS = "relative flex min-h-8 items-start gap-2 rounded px-2 py-1.5 text-xs text-on-surf hover:bg-sec-c/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
const NAME_EXCERPT_WORDS = 8
const WRAPPING_CHIP = '!whitespace-normal'
const NO_PHASES_TEXT = 'No phases are attributed to this consignment. See the full trip ledger.'

type MarkerKind = ParcelStep['marker'] | 'not-recorded'

const NODE_TYPES: Record<MarkerKind, PhaseNodeType> = { recorded: 'done', in_progress: 'active', warn: 'warn', 'not-recorded': 'pending' }
const NODE_SIZE = 'h-[30px] w-[30px]'

const ANCHOR_SENTENCES: Record<ParcelJourney['phases'][number]['anchor_status'], string> = {
  anchored: 'An anchor is recorded for this phase. Verify it in trip evidence.',
  failed: 'Phase anchor failed; the event is still recorded.',
  pending: 'Phase anchor is pending.',
  not_required: 'No anchor is required for this record.',
}

/** One node on the rail, plus the line down to the next item. The line takes the colour of the node it leaves, as on the trip page. */
function Rail({ kind, line }: { kind: MarkerKind; line: boolean }): JSX.Element {
  const type = NODE_TYPES[kind]
  return <>
    <span data-marker={kind} aria-hidden="true" className={`absolute left-0 top-[3px] flex ${NODE_SIZE} items-center justify-center rounded-full ${NODE_STYLE[type]}${kind === 'not-recorded' ? ' border-dashed' : ''}`}>
      {kind === 'recorded' && <Ic n="check" s={14} className="text-white" />}
      {kind === 'warn' && <Ic n="warn" s={14} />}
    </span>
    {line && <span data-rail aria-hidden="true" className={`absolute bottom-px left-[14px] top-[37px] w-0.5 ${LINE_STYLE[type]}`} />}
  </>
}

/** The first words of the description, so a screen reader still hears what the one-line link leads to. */
function descriptionExcerpt(description: string): string {
  const words = description.trim().split(/\s+/)
  return words.length > NAME_EXCERPT_WORDS ? `${words.slice(0, NAME_EXCERPT_WORDS).join(' ')}…` : words.join(' ')
}

/** One exception as one line: icon, time, type, severity, review state. The description is read on the exception page. */
function ExceptionLine({ item, returnTo }: { item: ParcelTraceException; returnTo: string }): JSX.Element {
  const when = fmtDateTime(item.recorded_at)
  const type = fmtExceptionType(item.exception_type)
  const severity = severityLabel(item.severity)
  const review = reviewStatusLabel(item.review_status)
  return <li>
    <Link href={withReturnTo(ROUTES.exceptionDetail(item.id), returnTo)} aria-label={`${when} · ${type} · ${severity} · ${review}. ${descriptionExcerpt(exceptionDescriptionText(item))}`} className={EXCEPTION_LINE_CLASS}>
      <Ic n="warn" s={13} className="mt-0.5 shrink-0 text-warn" />
      <span className="min-w-0">
        <time dateTime={item.recorded_at} className="tabular-nums text-on-surf-v">{when}</time> · <span className="font-semibold">{type}</span> · {severity} · <span className={awaitsReview(item) ? 'font-semibold text-warn-onc' : undefined}>{review}</span>
      </span>
    </Link>
  </li>
}

/** Labels muted, values at body weight: what was recorded stands apart from what it is called. Stacks on a narrow card. */
function Fields({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }): JSX.Element {
  return <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1">
    {rows.map(([label, value]) => <Fragment key={label}>
      <dt className="text-on-surf-v">{label}</dt>
      <dd className="mb-1.5 min-w-0 break-words text-on-surf sm:mb-0">{value}</dd>
    </Fragment>)}
  </dl>
}

/** Two clocks, kept apart: when the position was captured, and when the phase it belongs to was recorded. */
function positionRows(journey: ParcelJourney): Array<readonly [string, ReactNode]> {
  const fix = journey.last_recorded_location
  if (!fix) return []
  return [
    ['Position', locationLabel(journey)],
    ['Position source', fix.source === 'horse_tracker' ? 'Vehicle tracker' : 'Driver phone'],
    ['Position captured', <span key="c" className="tabular-nums">{fix.captured_at ? fmtFull(fix.captured_at) : 'Capture time not recorded'}</span>],
    ['Phase recorded', <span key="p" className="tabular-nums">{fix.phase_completed_at ? fmtFull(fix.phase_completed_at) : 'Time unavailable'}</span>],
  ]
}

function PhaseDetail({ step, journey, returnTo }: { step: ParcelStep; journey: ParcelJourney; returnTo: string }): JSX.Element {
  const phase = step.phase!
  const hasPosition = journey.last_recorded_location?.phase_event_id === phase.id
  const sealed = phase.phase_type === 'departure' && journey.seal_windows.some(window => window.phase_ids.includes(phase.id))
  const rows: Array<readonly [string, ReactNode]> = [
    ['Location', LOCATION_LABELS[phase.location_verdict]],
    ...(hasPosition ? positionRows(journey) : []),
    ['Device capture', <span key="d" className="tabular-nums">{phase.driver_captured_at ? fmtFull(phase.driver_captured_at) : 'Not recorded'}</span>],
    ...(phase.seal_number ? [['Recorded seal', <span key="s" className="break-all tabular-nums">{`${phase.seal_number}${phase.seal_condition ? ` · ${phase.seal_condition}` : ''}`}</span>] as const] : []),
    ['Anchor', ANCHOR_SENTENCES[phase.anchor_status]],
  ]
  return <div className={DETAIL_CLASS}>
    {step.exceptions.length > 0 && <ul className="-mx-2">{step.exceptions.map(item => <ExceptionLine key={item.id} item={item} returnTo={returnTo} />)}</ul>}
    <Fields rows={rows} />
    {hasPosition && <p>Vehicle or phone position; not parcel GPS or live tracking.</p>}
    {sealed && <p>Contents of a sealed load are not observable.</p>}
    {phase.override_note && <p className="rounded bg-warn-c/30 p-3 text-on-surf">Override note: {phase.override_note}</p>}
    <Link className={LINK_CLASS} href={tripEvidenceLink(journey.trip_id, returnTo, phase.id)}>Open phase evidence <Ic n="chev" s={12} /></Link>
  </div>
}

function ScanDetail({ step }: { step: ParcelStep }): JSX.Element {
  return <div className={DETAIL_CLASS}>
    <p>Recorded against the barcode; source system not identified.</p>
    <Fields rows={[['Stored scan status', step.scan!.status.replaceAll('_', ' ')]]} />
  </div>
}

/** Title line, then the subline. At most one issue pill, plus "Overridden"; a relevance the backend could not decide is muted text, not a pill. */
function StepHeading({ step, expandable = false }: { step: ParcelStep; expandable?: boolean }): JSX.Element {
  return <span className="min-w-0 flex-1">
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-sm font-semibold text-on-surf">{step.title}</span>
      {step.overridden && <Chip type="exception" className={WRAPPING_CHIP}>Overridden</Chip>}
      {step.relevanceUnknown && <span className="text-xs font-semibold text-on-surf-v">Relevance unknown</span>}
      {step.issuePill && <Chip type="exception" className={WRAPPING_CHIP}>{step.issuePill}</Chip>}
      {expandable && <Ic n="chev" s={14} className="shrink-0 text-on-surf-v transition-transform group-open:rotate-90 motion-reduce:transition-none" />}
    </span>
    <span className="mt-1.5 block text-xs tabular-nums text-on-surf-v">{step.subline}</span>
  </span>
}

function Step({ step, journey, returnTo, line }: { step: ParcelStep; journey: ParcelJourney; returnTo: string; line: boolean }): JSX.Element {
  return <li data-step={step.kind} data-step-key={step.key} className="relative pb-2 pl-[44px]">
    <Rail kind={step.marker} line={line} />
    {step.kind === 'cancelled' ? <div className="min-h-11 py-2"><StepHeading step={step} /></div> : <details className="group">
      <summary className={SUMMARY_CLASS}>
        <StepHeading step={step} expandable />
      </summary>
      {step.phase ? <PhaseDetail step={step} journey={journey} returnTo={returnTo} /> : <ScanDetail step={step} />}
    </details>}
  </li>
}

/** The API's own gap wording, verbatim: the page adds no sentence of its own about what a gap means. */
function Gaps({ gaps }: { gaps: readonly string[] }): JSX.Element | null {
  if (gaps.length === 0) return null
  return <ul aria-label="Evidence gaps" className="mt-1 space-y-1">
    {gaps.map((gap, index) => <li key={index} className="flex items-start gap-2 text-xs leading-relaxed text-on-surf-v">
      <Ic n="warn" s={12} className="mt-0.5 shrink-0 text-warn" /><span>{gap}</span>
    </li>)}
  </ul>
}

type TailRow = 'no-phases' | 'not-recorded' | 'gaps'

function NoPhasesRow({ line }: { line: boolean }): JSX.Element {
  return <li data-no-phases className="relative pb-2 pl-[44px]">
    <Rail kind="not-recorded" line={line} />
    <div className="min-h-11 py-2"><p className="text-sm text-on-surf-v">{NO_PHASES_TEXT}</p></div>
  </li>
}

function NotRecordedRow({ journey, items, line }: { journey: ParcelJourney; items: readonly string[]; line: boolean }): JSX.Element {
  return <li data-not-recorded className="relative pb-2 pl-[44px]">
    <Rail kind="not-recorded" line={line} />
    <div className="min-h-11 py-2 text-on-surf-v">
      <p className="text-sm">Not recorded: {items.join(', ')}</p>
      {journey.destination_name && <p className="text-xs">{journey.destination_name}</p>}
      <Gaps gaps={journey.gaps} />
    </div>
  </li>
}

/** Gaps with no not-recorded row to sit in become the final row, so an API gap is never dropped. */
function GapsRow({ gaps }: { gaps: readonly string[] }): JSX.Element {
  return <li data-gaps className="relative pb-2 pl-[44px]">
    <Rail kind="not-recorded" line={false} />
    <div className="min-h-11 py-2"><Gaps gaps={gaps} /></div>
  </li>
}

/**
 * What was recorded for one parcel, as a vertical rail of plain steps (scan-out, recorded phases, cancellation, scan-in), then what
 * was not recorded, then the way to the full trip ledger. Every step is a native disclosure; detail is one click away.
 */
export function ParcelTimeline({ journey, returnTo, headingLevel = 3 }: Props): JSX.Element {
  const steps = parcelSteps(journey)
  const missing = notRecordedItems(journey)
  const { phaseCount, tripWideExceptionCount } = hiddenLedgerCounts(journey)
  const counts = `${countLabel(phaseCount, 'phase')}${tripWideExceptionCount > 0 ? ` · ${countLabel(tripWideExceptionCount, 'trip-wide exception')}` : ''}`
  const hasPhaseRows = steps.some(step => step.kind === 'phase') || journey.phases.some(phase => phase.relevance === 'consignment')
  const tail: TailRow[] = [
    ...(hasPhaseRows ? [] : ['no-phases' as const]),
    ...(missing.length > 0 ? ['not-recorded' as const] : journey.gaps.length > 0 ? ['gaps' as const] : []),
  ]
  const lineAfter = (index: number): boolean => index < tail.length - 1
  return <div className="max-w-3xl">
    <Heading level={headingLevel} className="sr-only">What was recorded for this parcel</Heading>
    <ol>
      {steps.map((step, index) => <Step key={step.key} step={step} journey={journey} returnTo={returnTo} line={index < steps.length - 1 || tail.length > 0} />)}
      {tail.map((row, index) => row === 'no-phases' ? <NoPhasesRow key={row} line={lineAfter(index)} />
        : row === 'not-recorded' ? <NotRecordedRow key={row} journey={journey} items={missing} line={lineAfter(index)} />
        : <GapsRow key={row} gaps={journey.gaps} />)}
    </ol>
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <LinkButton href={tripEvidenceLink(journey.trip_id, returnTo)}>View trip</LinkButton>
      <span className="text-xs text-on-surf-v">{counts}</span>
    </div>
  </div>
}
