'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { cn } from '@shared/lib/utils/cn'
import { useAnalyticsChat } from '@/lib/hooks/useAnalyticsChat'
import type { Basis, SpendStatus } from '@shared/lib/types/analytics-chat'
import { ChatMessage } from './ChatMessage'
import { CHAT_COPY, spendLine } from './chatCopy'

/** The server's limit (app/schemas/analytics_chat.py MAX_QUESTION_CHARS). */
export const MAX_QUESTION_CHARS = 500
// A new answer is scrolled to this far below the top of the conversation, so its first line
// isn't flush against the header.
const ANSWER_SCROLL_GAP_PX = 8
// The thinking dots pulse one after another, this far apart.
const DOT_DELAY_MS = 150
const THINKING_DOTS = [0, 1, 2] as const

interface AnalyticsChatPanelProps {
  id?: string
  onClose: () => void
  /** This month's spend from the page's status read, until the first answer brings a newer one. */
  statusSpend: SpendStatus | null
  /** Re-read the status after a 429, to tell the per-minute limit from a spent budget. */
  onRecheckStatus: () => void
  /** Switch the page to a "Based on" line's tab and dates. */
  onOpenBasis: (basis: Basis) => void
}

/** The "Ask about these figures" side panel (FP-295). Sits beside the charts, not over them,
 *  so an answer can be checked against the chart it came from. Below the lg breakpoint it
 *  covers the page instead: beside a 400 px panel, a narrower page squeezes its tabs to
 *  single letters (seen in the browser check, 19 Oct). The page mounts it only while
 *  open, so closing it throws the conversation away (spec D7). */
export function AnalyticsChatPanel({ id, onClose, statusSpend, onRecheckStatus, onOpenBasis }: AnalyticsChatPanelProps) {
  const chat = useAnalyticsChat(onRecheckStatus)
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const countId = useId()
  const atLimit = question.length >= MAX_QUESTION_CHARS
  const logRef = useRef<HTMLDivElement>(null)
  const lastAnswerRef = useRef<HTMLDivElement>(null)

  const spend = chat.spend ?? statusSpend
  const budgetSpent = spend !== null && !spend.available
  const isSending = chat.pending !== null
  const canSend = !isSending && !budgetSpent && question.trim() !== ''

  useEffect(() => { inputRef.current?.focus() }, [])

  const lastMessage = chat.messages[chat.messages.length - 1]
  useEffect(() => {
    const log = logRef.current
    if (log === null) return
    const answer = lastAnswerRef.current
    if (chat.pending === null && lastMessage?.role === 'assistant' && answer !== null) {
      // A new answer: show its start, not its end, so a long answer is read from the top. Moved
      // within the conversation only, never the page around it.
      log.scrollTop += answer.getBoundingClientRect().top - log.getBoundingClientRect().top - ANSWER_SCROLL_GAP_PX
    } else {
      // A question sent: show it, with the thinking dots under it.
      log.scrollTop = log.scrollHeight
    }
  }, [chat.messages.length, chat.pending, lastMessage?.role])

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function ask(text: string): Promise<void> {
    if (isSending || budgetSpent) return
    // Cleared straight away (the question shows in the conversation while it's answered), and
    // put back only if the answer fails, ready for "Try again".
    setQuestion('')
    if (!(await chat.send(text))) setQuestion(text)
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    if (canSend) void ask(question)
  }

  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter asks; Shift+Enter makes a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canSend) void ask(question)
    }
  }

  const isEmpty = chat.messages.length === 0 && !isSending

  return (
    <aside
      id={id}
      aria-label={CHAT_COPY.title}
      className="fixed inset-0 z-[40] flex flex-col bg-surf-lowest lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-outline-v/20"
    >
      {/* A full-strength line under the header, so where the conversation starts is clear. */}
      <header className="flex items-start justify-between gap-3 border-b border-outline-v px-4 py-3">
        <div>
          <h2 className="text-[15px] font-[800] tracking-[-0.01em] text-on-surf">{CHAT_COPY.title}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-on-surf-v">{CHAT_COPY.intro}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={CHAT_COPY.close} className="rounded-md p-1 text-on-surf-v hover:bg-surf-low">
          <X size={18} />
        </button>
      </header>

      <div ref={logRef} role="log" aria-live="polite" className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {isEmpty && (
          <div className="flex flex-col items-start gap-2">
            {CHAT_COPY.starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => void ask(starter)}
                disabled={budgetSpent}
                className="rounded-lg border border-outline-v/30 px-3 py-2 text-left text-[13px] text-on-surf hover:bg-surf-low disabled:opacity-40"
              >
                {starter}
              </button>
            ))}
          </div>
        )}
        {chat.messages.map((message) => (
          <div key={message.id} ref={message === lastMessage && message.role === 'assistant' ? lastAnswerRef : undefined}>
            <ChatMessage message={message} onOpenBasis={onOpenBasis} />
          </div>
        ))}
        {chat.pending !== null && (
          <>
            <ChatMessage message={{ role: 'user', text: chat.pending }} onOpenBasis={onOpenBasis} />
            {/* Where the answer will appear, with three dots pulsing in turn while it's worked
                out. They hold still for anyone who has asked for reduced motion. */}
            <div role="status" className="flex items-center gap-1 self-start rounded-lg bg-surf-low px-3 py-3">
              <span className="sr-only">{CHAT_COPY.waiting}</span>
              {THINKING_DOTS.map((dot) => (
                <span
                  key={dot}
                  aria-hidden="true"
                  data-testid="thinking-dot"
                  className="h-1.5 w-1.5 rounded-full bg-on-surf-v motion-safe:animate-pulse"
                  style={{ animationDelay: `${dot * DOT_DELAY_MS}ms` }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-outline-v/20 px-4 py-3">
        {budgetSpent && <p role="alert" className="text-[12px] font-[600] text-warn">{CHAT_COPY.budgetSpent}</p>}
        {chat.error !== null && !budgetSpent && (
          <div role="alert" className="flex items-center justify-between gap-2 text-[12px] text-err">
            <span>{chat.error || CHAT_COPY.errorFallback}</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => void ask(question)} disabled={!canSend}>
              {CHAT_COPY.retry}
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* One box: the text above, and the counter in its own strip along the bottom-right,
              so typed text scrolls above it and never runs underneath. The counter shows the
              limit before the box stops taking characters, and turns the warning colour once it
              does. The border sits on the wrapper, so focus colours the whole box. */}
          <div className="flex flex-1 flex-col rounded-md border border-outline-v/30 bg-surf-low focus-within:border-sec">
            <textarea
              ref={inputRef}
              aria-label={CHAT_COPY.inputLabel}
              aria-describedby={countId}
              placeholder={CHAT_COPY.placeholder}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onInputKey}
              maxLength={MAX_QUESTION_CHARS}
              disabled={budgetSpent}
              rows={2}
              className="min-h-[44px] w-full resize-none rounded-md bg-transparent px-3 pt-2 text-[13px] text-on-surf placeholder:text-on-surf-v/60 focus:outline-none disabled:opacity-50"
            />
            <span
              aria-hidden="true"
              data-testid="question-char-count"
              className={cn(
                'self-end px-2.5 pb-1 text-[10px] leading-none tabular-nums',
                atLimit ? 'font-[600] text-warn' : 'text-on-surf-v/60',
              )}
            >
              {CHAT_COPY.charCount(question.length, MAX_QUESTION_CHARS)}
            </span>
            <span id={countId} className="sr-only">{CHAT_COPY.charCountSpoken(question.length, MAX_QUESTION_CHARS)}</span>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={!canSend}
            loading={isSending}
            className="hover:underline hover:decoration-white hover:underline-offset-2"
          >
            {CHAT_COPY.send}
          </Button>
        </div>
        {spend !== null && <p className="text-[11px] text-on-surf-v tabular-nums">{spendLine(spend)}</p>}
      </form>
    </aside>
  )
}
