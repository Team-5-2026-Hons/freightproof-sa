// Words for the "Ask about these figures" panel (FP-295 spec §5). Kept apart from the
// fleet tabs' copy.ts, which is already long.

import { fmtDay } from '@/lib/format/period'
import type { Basis, SpendStatus } from '@shared/lib/types/analytics-chat'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

export const CHAT_COPY = {
  open: 'Ask about these figures',
  title: 'Ask about these figures',
  intro: "Answers come only from this page's figures. Don't type names, phone or ID numbers.",
  starters: [
    'How did delays change over the past year?',
    'What did delays cost us in the last 12 weeks?',
    'How many critical problems are waiting for review right now?',
  ],
  inputLabel: 'Your question',
  placeholder: 'Ask a question about the fleet figures',
  /** The counter in the box's corner, e.g. "123/500"; read aloud as charCountSpoken. */
  charCount: (used: number, max: number): string => `${used}/${max}`,
  charCountSpoken: (used: number, max: number): string => `${used} of ${max} characters`,
  send: 'Ask',
  close: 'Close',
  waiting: 'Looking up the figures…',
  you: 'You',
  assistant: 'Answer',
  noFigures: 'No figures used',
  explained: "Explained from the page's own notes",
  basedOn: 'Based on:',
  rightNow: 'Right now',
  openTab: (label: string): string => `Open ${label} with these dates`,
  budgetSpent: 'The AI budget for this month is used up. It resets on the 1st.',
  errorFallback: "Couldn't get an answer. Try again.",
  retry: 'Try again',
} as const

/** "1 Nov 2025 – 19 Oct 2026 · by month · 412 trips", or "Right now" for the tiles. */
export function basisDetail(basis: Basis): string {
  if (basis.start === null || basis.end === null) return CHAT_COPY.rightNow
  const parts = [`${fmtDay(basis.start)} – ${fmtDay(basis.end)}`]
  if (basis.grain !== null) parts.push(`by ${basis.grain}`)
  if (basis.closed_trip_count !== null) {
    parts.push(`${basis.closed_trip_count} ${basis.closed_trip_count === 1 ? 'trip' : 'trips'}`)
  }
  return parts.join(' · ')
}

export function spendLine(spend: SpendStatus): string {
  return `AI spend this month: ${USD.format(spend.spent_usd)} of ${USD.format(spend.budget_usd)}`
}
