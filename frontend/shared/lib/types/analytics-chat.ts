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

/** What the dispatcher has on screen when they ask (B45): the open tab, its Period and the View by drawn. Lets
 *  "what do these figures tell us?" be answered for that period instead of asking for one. */
export interface ChatPageView {
  tab: 'activity' | 'on-time' | 'problems' | 'review' | 'evidence' | 'routes' | 'cost'
  preset: 'last_4_weeks' | 'last_12_weeks' | 'last_26_weeks' | 'last_3_months' | 'last_6_months'
    | 'last_12_months' | 'this_year' | 'last_3_years' | 'all_time' | 'custom'
  start?: string
  end?: string
  grain: Grain | null
}

export interface ChatRequest {
  question: string
  history: ChatTurn[]
  page?: ChatPageView
}

/** One tool call an answer rests on: which tab, which dates, how many closed trips. */
export interface Basis {
  tool: string
  tab: string | null
  label: string
  start: string | null
  end: string | null
  grain: Grain | null
  closed_trip_count: number | null
}

export interface SpendStatus {
  spent_usd: number
  budget_usd: number
  available: boolean
}

/** answer: rests on figures · follow_up: the model asked a question back · explanation: explained from the
 *  page's own notes, no figures (B45) · declined: none of these. */
export type ChatAnswerKind = 'answer' | 'follow_up' | 'explanation' | 'declined'

export interface ChatAnswer {
  answer: string
  kind: ChatAnswerKind
  basis: Basis[]
  spend: SpendStatus | null
}

export interface ChatStatus {
  enabled: boolean
  spend: SpendStatus | null
}
