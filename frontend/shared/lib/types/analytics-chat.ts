// Types for the "Ask about these figures" panel on the fleet Analytics page (FP-295).
// Mirrors backend models in app/schemas/analytics_chat.py.
//
// The "Based on" lines (Basis) are built by the server from the tools that actually ran,
// never written by the model, so the panel shows them as they arrive.

import type { Grain } from './fleet-analytics'

/** One earlier message, sent back as text so follow-ups ("and the month before?") work. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatRequest {
  question: string
  /** Oldest first, at most 10 (the server rejects more). */
  history: ChatTurn[]
}

/** One tool call an answer rests on: which tab, which dates, how many closed trips. */
export interface Basis {
  tool: string
  /** The page's tab id; null for the headline tiles ("Right now"), which sit above the tabs. */
  tab: string | null
  label: string
  /** "YYYY-MM-DD"; null for the headline tiles. */
  start: string | null
  end: string | null
  /** null for the tiles and for Routes & sites (no View by). */
  grain: Grain | null
  closed_trip_count: number | null
}

export interface SpendStatus {
  /** This organisation, this calendar month, in US dollars. */
  spent_usd: number
  budget_usd: number
  /** False once the monthly budget is used up. */
  available: boolean
}

/** answer: rests on figures · follow_up: the model asked a question back · declined: neither. */
export type ChatAnswerKind = 'answer' | 'follow_up' | 'declined'

export interface ChatAnswer {
  answer: string
  kind: ChatAnswerKind
  /** Empty → "No figures used". */
  basis: Basis[]
  spend: SpendStatus | null
}

export interface ChatStatus {
  enabled: boolean
  spend: SpendStatus | null
}
