'use client'

import { cn } from '@shared/lib/utils/cn'
import type { Basis } from '@shared/lib/types/analytics-chat'
import type { ChatMessageItem } from '@/lib/hooks/useAnalyticsChat'
import { BasisLine } from './BasisLine'
import { CHAT_COPY } from './chatCopy'

interface ChatMessageProps {
  message: Pick<ChatMessageItem, 'role' | 'text' | 'basis'>
  onOpenBasis: (basis: Basis) => void
}

/** One turn of the conversation. Text is rendered as text (line breaks kept), never as HTML:
 *  it comes from a model and may contain anything. */
export function ChatMessage({ message, onOpenBasis }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const basis = message.basis ?? []
  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <span className="sr-only">{isUser ? CHAT_COPY.you : CHAT_COPY.assistant}:</span>
      <div
        className={cn(
          'max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          isUser ? 'bg-on-surf text-white' : 'bg-surf-low text-on-surf',
        )}
      >
        {message.text}
      </div>
      {!isUser && (
        <div className="flex max-w-[92%] flex-col gap-0.5 px-1">
          {basis.length === 0 ? (
            <p className="text-[11px] text-on-surf-v">{CHAT_COPY.noFigures}</p>
          ) : (
            basis.map((item) => (
              <BasisLine key={`${item.tool}-${item.start}-${item.end}-${item.grain}`} basis={item} onOpen={onOpenBasis} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
