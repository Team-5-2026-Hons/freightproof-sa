// Which arrangement an opened phase card uses for Recorded and Checked (D30). Pure so vitest can
// prove it; the width itself is measured on the card, never read from the viewport.
//
// Measured card content widths: 772 px at 1440 and on a 1024 tablet, 676 px at 1280 with the
// exceptions panel docked, 564 px on a 768 tablet. Two columns need about 740 px to keep each
// readable, so the common 1280 laptop stacks, and the stacked layout is the one most often shown.

import type { PhaseType } from '@shared/lib/types/phase'
import type { PhaseCheck } from './checks'

/** Narrowest card body, in px, that still reads well as two columns. */
export const SPLIT_MIN_PX = 740

export type BodyLayout = 'split' | 'stacked'

interface Input {
  /** The observed card-body width, or null before the first measurement. */
  widthPx: number | null
  /** Checks the card has to show; a card with none leaves the second column empty. */
  checkCount: number
  phaseType: PhaseType
}

/** Side by side only when the card is wide enough, has at least one check, and is not in_transit:
 *  that card's Checked column is one standing line, so a split would leave half of it empty on
 *  the phase that matters most. Unmeasured is stacked: the layout that holds from 564 px up. */
export function chooseBodyLayout({ widthPx, checkCount, phaseType }: Input): BodyLayout {
  if (phaseType === 'in_transit' || checkCount < 1) return 'stacked'
  return widthPx !== null && widthPx >= SPLIT_MIN_PX ? 'split' : 'stacked'
}

/** The checks that count toward "has at least one check". A running scan is an observation, not a
 *  result (D34), and a card whose only line is one has nothing for a second column to hold. */
export function realCheckCount(checks: readonly PhaseCheck[]): number {
  return checks.filter(check => check.result !== 'in_progress').length
}
