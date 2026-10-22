'use client'

import { cn } from '@shared/lib/utils/cn'
import type { RecordRef } from '@shared/lib/types/assistant'
import type { AssistantMessageItem } from '@/lib/hooks/useAssistant'
import { answerBlocks, inlineParts } from '@/components/analytics/chat/answerFormat'
import { ActionButton } from './ActionButton'
import { AssistantCardView } from './cards/AssistantCardView'
import { ASSISTANT_COPY, checkedLine } from './assistantCopy'
import type { NavigateTo } from './navigation'

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) => (
        part.strong ? <strong key={index} className="font-[700]">{part.text}</strong> : <span key={index}>{part.text}</span>
      ))}
    </>
  )
}

/** A reply as paragraphs and lists, read the same way as the Analytics chat's (its answerFormat.ts). */
function ReplyText({ text }: { text: string }) {
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
          <List key={index} className={cn('flex flex-col gap-1 pl-4', block.kind === 'bullets' ? 'list-disc' : 'list-decimal')}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
          </List>
        )
      })}
    </div>
  )
}

interface AssistantMessageProps {
  message: Pick<AssistantMessageItem, 'role' | 'text' | 'cards' | 'actions' | 'toolsUsed'>
  onNavigate: NavigateTo
  onChoose: (record: RecordRef) => void
  busy: boolean
}

/** One turn. Text is rendered as text, never HTML: it comes from a model and may contain anything.
 *  An answer is followed by its cards, then the "Checked:" line our server wrote. */
export function AssistantMessage({ message, onNavigate, onChoose, busy }: AssistantMessageProps) {
  const isUser = message.role === 'user'
  const cards = message.cards ?? []
  const tools = message.toolsUsed ?? []
  return (
    <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      <span className="sr-only">{isUser ? ASSISTANT_COPY.you : ASSISTANT_COPY.assistant}:</span>
      <div
        className={cn(
          'max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          isUser ? 'whitespace-pre-wrap bg-on-surf text-white' : 'bg-surf-low text-on-surf',
        )}
      >
        {isUser ? message.text : <ReplyText text={message.text} />}
      </div>
      {!isUser && cards.map((card, index) => (
        <AssistantCardView key={index} card={card} onNavigate={onNavigate} onChoose={onChoose} busy={busy} />
      ))}
      {!isUser && (message.actions ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(message.actions ?? []).map((action) => (
            <ActionButton key={`${action.kind}-${action.label}`} action={action} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      {!isUser && (
        <p className="px-1 text-[11px] text-on-surf-v">
          {tools.length === 0 ? ASSISTANT_COPY.nothingChecked : `${ASSISTANT_COPY.checked} ${checkedLine(tools)}`}
        </p>
      )}
    </div>
  )
}
