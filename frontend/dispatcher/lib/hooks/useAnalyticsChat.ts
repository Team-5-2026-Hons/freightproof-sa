'use client'

import { useCallback, useRef, useState } from 'react'

import { ApiError, api } from '@/lib/api/client'
import { useFleetQuery } from '@/lib/hooks/useFleetAnalytics'
import type { Basis, ChatAnswer, ChatAnswerKind, ChatPageView, ChatStatus, ChatTurn, SpendStatus } from '@shared/lib/types/analytics-chat'

export const CHAT_PATH = '/api/v1/analytics/chat'
export const CHAT_STATUS_PATH = '/api/v1/analytics/chat/status'
export const CHAT_TIMEOUT_MS = 60_000
export const MAX_HISTORY_TURNS = 10
const HTTP_TOO_MANY_REQUESTS = 429

/** Whether the chat is switched on, and this month's spend, through the fleet pages' own
 *  query hook. While it loads or if it fails, `enabled` is false: the page shows no button. */
export function useChatStatus(): { enabled: boolean; spend: SpendStatus | null; refetch: () => void } {
  const { data, refetch } = useFleetQuery<ChatStatus>(CHAT_STATUS_PATH)
  return { enabled: data?.enabled ?? false, spend: data?.spend ?? null, refetch }
}

export interface ChatMessageItem {
  id: number
  role: 'user' | 'assistant'
  text: string
  kind?: ChatAnswerKind
  basis?: Basis[]
}

export interface AnalyticsChat {
  messages: ChatMessageItem[]
  pending: string | null
  error: string | null
  spend: SpendStatus | null
  /** Resolves true when an answer arrived; false leaves the question for the dispatcher to retry. `page` is what
   *  the dispatcher has on screen, so "these figures" means the period they're looking at. */
  send: (question: string, page?: ChatPageView) => Promise<boolean>
}

/** The text the server gets back as history: the last MAX_HISTORY_TURNS messages. */
export function historyFor(messages: ChatMessageItem[]): ChatTurn[] {
  return messages.slice(-MAX_HISTORY_TURNS).map(({ role, text }) => ({ role, text }))
}

/** One conversation in the panel. Kept only in this component's state: closing the panel
 *  unmounts it and the conversation is gone (FP-295 D7). */
export function useAnalyticsChat(onTooManyRequests: () => void): AnalyticsChat {
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [spend, setSpend] = useState<SpendStatus | null>(null)
  const nextId = useRef(0)

  const send = useCallback(async (question: string, page?: ChatPageView): Promise<boolean> => {
    const trimmed = question.trim()
    if (trimmed === '') return false
    setPending(trimmed)
    setError(null)
    try {
      const answer = await api.post<ChatAnswer>(
        CHAT_PATH,
        { question: trimmed, history: historyFor(messages), ...(page === undefined ? {} : { page }) },
        { timeoutMs: CHAT_TIMEOUT_MS },
      )
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: 'user', text: trimmed },
        { id: nextId.current++, role: 'assistant', text: answer.answer, kind: answer.kind, basis: answer.basis },
      ])
      if (answer.spend !== null) setSpend(answer.spend)
      return true
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      if (err instanceof ApiError && err.status === HTTP_TOO_MANY_REQUESTS) {
        setSpend(null)
        onTooManyRequests()
      }
      return false
    } finally {
      setPending(null)
    }
  }, [messages, onTooManyRequests])

  return { messages, pending, error, spend, send }
}
