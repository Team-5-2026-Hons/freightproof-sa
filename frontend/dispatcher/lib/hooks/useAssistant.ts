'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, api } from '@/lib/api/client'
import { useAsyncData } from '@/lib/hooks/useAsyncData'
import type {
  AssistantAction,
  AssistantAnswer,
  AssistantAnswerKind,
  AssistantCard,
  AssistantSpend,
  AssistantStatus,
  AssistantTurn,
  RecordRef,
} from '@shared/lib/types/assistant'

export const ASSISTANT_CHAT_PATH = '/api/v1/assistant/chat'
export const ASSISTANT_STATUS_PATH = '/api/v1/assistant/status'
/** An answer can take several model calls and look-ups; the server gives each model call 30 s with one
 *  retry, so a minute covers the slow case without hanging forever (the Analytics chat's figure). */
export const ASSISTANT_TIMEOUT_MS = 60_000
/** The server rejects more (app/schemas/assistant.py MAX_HISTORY_TURNS, MAX_REFS_PER_TURN). */
export const MAX_HISTORY_TURNS = 10
export const MAX_REFS_PER_TURN = 30
/** One key for the whole conversation, versioned so a changed shape is never read back. */
export const ASSISTANT_STORAGE_KEY = 'fp.assistant.conversation.v1'
const HTTP_TOO_MANY_REQUESTS = 429
/** The client reports a timeout or a dropped connection as status 0 (lib/api/client.ts). Its message names the
 *  URL and the milliseconds, which mean nothing to a dispatcher, so it is replaced with plain words. */
const NO_RESPONSE_STATUS = 0
export const NO_ANSWER_IN_TIME = "The answer didn't arrive in time. Try again."

/** Whether the bubble should show, and this month's spend. While it loads or if it fails, `enabled`
 *  is false: no bubble, and the rest of the app is untouched. */
export function useAssistantStatus(): { enabled: boolean; spend: AssistantSpend | null; refetch: () => void } {
  const fetchStatus = useCallback(() => api.get<AssistantStatus>(ASSISTANT_STATUS_PATH), [])
  const { data, refetch } = useAsyncData<AssistantStatus | null>(fetchStatus, null)
  return { enabled: data?.enabled ?? false, spend: data?.spend ?? null, refetch }
}

export interface AssistantMessageItem {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** The records this turn showed (assistant) or meant (a choice the user clicked). */
  refs: RecordRef[]
  /** Assistant messages only. */
  kind?: AssistantAnswerKind
  cards?: AssistantCard[]
  /** Buttons that open a page. */
  actions?: AssistantAction[]
  toolsUsed?: string[]
}

/** The turns the server gets back: the last MAX_HISTORY_TURNS, each with its records. */
export function historyFor(messages: AssistantMessageItem[]): AssistantTurn[] {
  return messages.slice(-MAX_HISTORY_TURNS).map(({ role, text, refs }) => ({
    role, text, refs: refs.slice(0, MAX_REFS_PER_TURN),
  }))
}

/** The saved conversation, or none. Storage can be missing or throw (private windows, blocked site data),
 *  and an old or damaged entry is simply ignored: a fresh chat is always a safe fallback. */
export function loadConversation(storage: Pick<Storage, 'getItem'> | undefined): AssistantMessageItem[] {
  try {
    const raw = storage?.getItem(ASSISTANT_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as AssistantMessageItem[]) : []
  } catch {
    return []
  }
}

function saveConversation(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, messages: AssistantMessageItem[]): void {
  try {
    if (messages.length === 0) storage?.removeItem(ASSISTANT_STORAGE_KEY)
    else storage?.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // Storage full or blocked: the conversation still works for this page load.
  }
}

function sessionStore(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

/** A question that got no answer, kept so it can be put back and retried even if the pop-up was closed meanwhile. */
export interface FailedQuestion {
  question: string
  refs: RecordRef[]
}

export interface Assistant {
  messages: AssistantMessageItem[]
  /** The question being answered right now, shown until the answer arrives. */
  pending: string | null
  error: string | null
  /** This month's spend from the latest answer; null until the first one (the status read covers that). */
  spend: AssistantSpend | null
  /** The last question that failed, until one succeeds or the chat is reset. */
  failed: FailedQuestion | null
  /** Resolves true when an answer arrived; false keeps the question in `failed` for a retry. */
  send: (question: string, refs?: RecordRef[]) => Promise<boolean>
  /** Ask the failed question again, with the records it meant. */
  retry: () => Promise<boolean>
  /** "New chat": forget the conversation. */
  reset: () => void
}

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status === NO_RESPONSE_STATUS) return NO_ANSWER_IN_TIME
  return err instanceof Error ? err.message : 'An unexpected error occurred'
}

/** One conversation, kept in sessionStorage (spec D6): it survives moving between pages and a refresh,
 *  and is gone when the tab closes or on "New chat". Nothing is stored on the server. */
export function useAssistant(onTooManyRequests: () => void): Assistant {
  const [messages, setMessages] = useState<AssistantMessageItem[]>(() => loadConversation(sessionStore()))
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [spend, setSpend] = useState<AssistantSpend | null>(null)
  const [failed, setFailed] = useState<FailedQuestion | null>(null)
  const nextId = useRef(messages.reduce((highest, message) => Math.max(highest, message.id + 1), 0))

  useEffect(() => { saveConversation(sessionStore(), messages) }, [messages])

  const send = useCallback(async (question: string, refs: RecordRef[] = []): Promise<boolean> => {
    const trimmed = question.trim()
    if (trimmed === '') return false
    setPending(trimmed)
    setError(null)
    try {
      const answer = await api.post<AssistantAnswer>(
        ASSISTANT_CHAT_PATH,
        { question: trimmed, history: historyFor(messages), refs: refs.slice(0, MAX_REFS_PER_TURN) },
        { timeoutMs: ASSISTANT_TIMEOUT_MS },
      )
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: 'user', text: trimmed, refs },
        {
          id: nextId.current++, role: 'assistant', text: answer.answer, refs: answer.refs,
          kind: answer.kind, cards: answer.cards, actions: answer.actions, toolsUsed: answer.tools_used,
        },
      ])
      if (answer.spend !== null) setSpend(answer.spend)
      setFailed(null)
      return true
    } catch (err: unknown) {
      setError(errorText(err))
      setFailed({ question: trimmed, refs })
      // A 429 is the per-minute limit or the monthly budget: re-reading the status says which.
      if (err instanceof ApiError && err.status === HTTP_TOO_MANY_REQUESTS) {
        setSpend(null)
        onTooManyRequests()
      }
      return false
    } finally {
      setPending(null)
    }
  }, [messages, onTooManyRequests])

  const retry = useCallback(
    (): Promise<boolean> => (failed === null ? Promise.resolve(false) : send(failed.question, failed.refs)),
    [failed, send],
  )

  const reset = useCallback(() => {
    setMessages([])
    setError(null)
    setFailed(null)
  }, [])

  return { messages, pending, error, spend, failed, send, retry, reset }
}
