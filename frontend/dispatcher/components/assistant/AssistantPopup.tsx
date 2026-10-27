'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { cn } from '@shared/lib/utils/cn'
import type { Assistant } from '@/lib/hooks/useAssistant'
import type { AssistantSpend, RecordRef } from '@shared/lib/types/assistant'
import { AssistantMessage } from './AssistantMessage'
import type { NavigateTo } from './navigation'
import { ASSISTANT_COPY, spendLine } from './assistantCopy'

export const MAX_QUESTION_CHARS = 500
const ANSWER_SCROLL_GAP_PX = 8
const DOT_DELAY_MS = 150
const THINKING_DOTS = [0, 1, 2] as const

interface AssistantPopupProps {
  id: string
  assistant: Assistant
  statusSpend: AssistantSpend | null
  /** Shrink back to the bubble, returning focus to it. */
  onMinimise: () => void
  onNavigate: NavigateTo
}

/** The assistant's pop-up (spec §3, D6): floats bottom-right above the page without covering all of it,
 *  and follows the dispatcher across pages. Non-modal, so the page stays usable. Below md it fills the
 *  screen instead: a 400 px window leaves no room for the page on a phone. */
export function AssistantPopup({ id, assistant, statusSpend, onMinimise, onNavigate }: AssistantPopupProps) {
  const [question, setQuestion] = useState(() => {
    const failedBefore = assistant.failed
    return failedBefore !== null && failedBefore.refs.length === 0 ? failedBefore.question : ''
  })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const lastAnswerRef = useRef<HTMLDivElement>(null)
  const countId = useId()
  const titleId = useId()

  const spend = assistant.spend ?? statusSpend
  const budgetSpent = spend !== null && !spend.available
  const isSending = assistant.pending !== null
  const canSend = !isSending && !budgetSpent && question.trim() !== ''
  const atLimit = question.length >= MAX_QUESTION_CHARS

  useEffect(() => { inputRef.current?.focus() }, [])

  const lastMessage = assistant.messages[assistant.messages.length - 1]
  useEffect(() => {
    const log = logRef.current
    if (log === null) return
    const answer = lastAnswerRef.current
    if (assistant.pending === null && lastMessage?.role === 'assistant' && answer !== null) {
      log.scrollTop += answer.getBoundingClientRect().top - log.getBoundingClientRect().top - ANSWER_SCROLL_GAP_PX
    } else {
      log.scrollTop = log.scrollHeight
    }
  }, [assistant.messages.length, assistant.pending, lastMessage?.role])

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') onMinimise()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onMinimise])

  const failed = assistant.failed
  const [seenFailure, setSeenFailure] = useState(failed)
  if (failed !== seenFailure) {
    setSeenFailure(failed)
    if (failed !== null && failed.refs.length === 0 && question === '') setQuestion(failed.question)
  }

  function ask(text: string, refs: RecordRef[] = []): void {
    if (isSending || budgetSpent) return
    setQuestion('')
    void assistant.send(text, refs)
  }

  function retry(): void {
    if (isSending || budgetSpent) return
    setQuestion('')
    void assistant.retry()
  }

  function onChoose(record: RecordRef): void {
    ask(`I mean ${record.label}`, [record])
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    if (canSend) ask(question)
  }

  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canSend) ask(question)
    }
  }

  const isEmpty = assistant.messages.length === 0 && !isSending

  return (
    <div
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={cn(
        'fixed inset-0 z-[35] flex flex-col bg-surf-lowest',
        'md:inset-auto md:bottom-24 md:right-6 md:h-[min(600px,calc(100vh-8rem))] md:w-[400px]',
        'md:rounded-xl md:border md:border-outline-v/30 md:shadow-level-6',
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-outline-v px-4 py-3">
        <div>
          <h2 id={titleId} className="text-[15px] font-[800] tracking-[-0.01em] text-on-surf">{ASSISTANT_COPY.title}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-on-surf-v">{ASSISTANT_COPY.note}</p>
        </div>
        <div className="flex items-center gap-1">
          {assistant.messages.length > 0 && (
            <Button type="button" variant="secondary" size="sm" onClick={assistant.reset} disabled={isSending}>
              {ASSISTANT_COPY.newChat}
            </Button>
          )}
          <button
            type="button"
            onClick={onMinimise}
            aria-label={ASSISTANT_COPY.minimise}
            className="rounded-md p-1 text-on-surf-v hover:bg-surf-low"
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </header>

      <div ref={logRef} role="log" aria-live="polite" className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {isEmpty && (
          <div className="flex flex-col items-start gap-2">
            {ASSISTANT_COPY.starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => ask(starter)}
                disabled={budgetSpent}
                className="rounded-lg border border-outline-v/30 px-3 py-2 text-left text-[13px] text-on-surf hover:bg-surf-low disabled:opacity-40"
              >
                {starter}
              </button>
            ))}
          </div>
        )}
        {assistant.messages.map((message) => (
          <div key={message.id} ref={message === lastMessage && message.role === 'assistant' ? lastAnswerRef : undefined}>
            <AssistantMessage message={message} onNavigate={onNavigate} onChoose={onChoose} busy={isSending} />
          </div>
        ))}
        {assistant.pending !== null && (
          <>
            <AssistantMessage message={{ role: 'user', text: assistant.pending }} onNavigate={onNavigate} onChoose={onChoose} busy />
            <div role="status" className="flex items-center gap-1 self-start rounded-lg bg-surf-low px-3 py-3">
              <span className="sr-only">{ASSISTANT_COPY.waiting}</span>
              {THINKING_DOTS.map((dot) => (
                <span
                  key={dot}
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-on-surf-v motion-safe:animate-pulse"
                  style={{ animationDelay: `${dot * DOT_DELAY_MS}ms` }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-outline-v/20 px-4 py-3">
        {budgetSpent && <p role="alert" className="text-[12px] font-[600] text-warn">{ASSISTANT_COPY.budgetSpent}</p>}
        {assistant.error !== null && !budgetSpent && (
          <div role="alert" className="flex items-center justify-between gap-2 text-[12px] text-err">
            <span>{assistant.error || ASSISTANT_COPY.errorFallback}</span>
            <Button type="button" variant="secondary" size="sm" onClick={retry} disabled={failed === null || isSending}>
              {ASSISTANT_COPY.retry}
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col rounded-md border border-outline-v/30 bg-surf-low focus-within:border-sec">
            <textarea
              ref={inputRef}
              aria-label={ASSISTANT_COPY.inputLabel}
              aria-describedby={countId}
              placeholder={ASSISTANT_COPY.placeholder}
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
              className={cn('self-end px-2.5 pb-1 text-[10px] leading-none tabular-nums', atLimit ? 'font-[600] text-warn' : 'text-on-surf-v/60')}
            >
              {ASSISTANT_COPY.charCount(question.length, MAX_QUESTION_CHARS)}
            </span>
            <span id={countId} className="sr-only">{ASSISTANT_COPY.charCountSpoken(question.length, MAX_QUESTION_CHARS)}</span>
          </div>
          <Button type="submit" size="sm" disabled={!canSend} loading={isSending}>{ASSISTANT_COPY.send}</Button>
        </div>
        {spend !== null && <p className="text-[11px] text-on-surf-v tabular-nums">{spendLine(spend)}</p>}
      </form>
    </div>
  )
}
