import type { JSX } from 'react'
import { InfoPopover } from '@/components/analytics/fleet/InfoPopover'
import { POPOVER_ANCHOR_END } from '@/components/ui/popoverAnchor'
import { TRIP_HELP, type TripHelpEntry, type TripHelpTopic } from './trip-help-copy'
import { KEEP_EXCEPTION_SELECTION_ATTR } from './useDismissExceptionSelection'

// A long panel scrolls inside itself instead of running off the bottom of the screen.
const SCROLLING_PANEL = '[&_[role=region]]:overflow-y-auto'
const DEFAULT_MAX_HEIGHT = '[&_[role=region]]:max-h-[70vh]'

interface Props {
  topic: TripHelpTopic
  /** Placement of the icon, for a caller whose row cannot simply be `relative` (e.g. an icon lifted into padding). */
  className?: string
  /** Replaces the default height cap with a full `[&_[role=region]]:max-h-[…]` class, for a panel that opens inside a smaller scroll area. */
  maxHeight?: string
}

/**
 * The "i" for one section of the trip page. The copy lives in trip-help-copy.ts. The wrapper carries
 * KEEP_EXCEPTION_SELECTION_ATTR because opening an explanation is reading around a selected exception, not
 * leaving it, the same as the timeline's own view controls. The panel anchors to the nearest positioned ancestor
 * (see POPOVER_ANCHOR_END), so the caller's row must be `relative`, or this wrapper must be positioned via `className`.
 */
export function TripHelp({ topic, className = '', maxHeight = DEFAULT_MAX_HEIGHT }: Props): JSX.Element {
  const entry: TripHelpEntry = TRIP_HELP[topic]
  return <span {...{ [KEEP_EXCEPTION_SELECTION_ATTR]: true }} className={`${POPOVER_ANCHOR_END} ${SCROLLING_PANEL} ${maxHeight} ${className}`.trim()}>
    <InfoPopover title={entry.label} ariaLabel={entry.label} question={entry.question} basis={entry.basis} note={entry.note} footnote={entry.footnote} />
  </span>
}
