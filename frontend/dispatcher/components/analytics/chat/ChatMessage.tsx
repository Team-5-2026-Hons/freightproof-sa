'use client'

import { cn } from '@shared/lib/utils/cn'
import type { Basis } from '@shared/lib/types/analytics-chat'
import type { ChatMessageItem } from '@/lib/hooks/useAnalyticsChat'
import { answerBlocks, inlineParts } from './answerFormat'
import { BasisLine } from './BasisLine'
import { CHAT_COPY } from './chatCopy'

interface ChatMessageProps {
  message: Pick<ChatMessageItem, 'role' | 'text' | 'basis'>
  onOpenBasis: (basis: Basis) => void
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) => (
        part.strong ? <strong key={index} className="font-[700]">{part.text}</strong> : <span key={index}>{part.text}</span>
      ))}
    </>
  )
}

/** An answer as paragraphs and lists (answerFormat.ts), so a long answer can be scanned. */
function AnswerText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {answerBlocks(text).map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>{lineIndex > 0 && <br />}<Inline text={line} /></span>
              ))}
            </p>
          )
        }
        const List = block.kind === 'bullets' ? 'ul' : 'ol'
        return (
          <List
            key={index}
            className={cn('flex flex-col gap-1 pl-4 marker:text-on-surf-v', block.kind === 'bullets' ? 'list-disc' : 'list-decimal')}
          >
            {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-0.5"><Inline text={item} /></li>)}
          </List>
        )
      })}
    </div>
  )
}

/** One turn of the conversation. Text is rendered as text, never as HTML: it comes from a model
 *  and may contain anything. A question is shown as typed; an answer as paragraphs and lists. */
export function ChatMessage({ message, onOpenBasis }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const basis = message.basis ?? []
  return (
    <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      <span className="sr-only">{isUser ? CHAT_COPY.you : CHAT_COPY.assistant}:</span>
      <div
        className={cn(
          'max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          isUser ? 'whitespace-pre-wrap bg-on-surf text-white' : 'bg-surf-low text-on-surf',
        )}
      >
        {isUser ? message.text : <AnswerText text={message.text} />}
      </div>
      {!isUser && (
        <div className="flex max-w-[92%] flex-wrap items-center gap-1.5 px-1">
          {basis.length === 0 ? (
            <p className="text-[11px] text-on-surf-v">{CHAT_COPY.noFigures}</p>
          ) : (
            <>
              <span className="text-[11px] font-[600] text-on-surf-v">{CHAT_COPY.basedOn}</span>
              {basis.map((item) => (
                <BasisLine key={`${item.tool}-${item.start}-${item.end}-${item.grain}`} basis={item} onOpen={onOpenBasis} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
