'use client'

import { useState } from 'react'
import { ChevronDown, MessageSquareText, TriangleAlert } from 'lucide-react'
import type { TripException } from '@shared/lib/types/exception'
import { isDispatcherNote } from '@/lib/utils/trip-attention'
import { cn } from '@/lib/utils'

interface ExceptionCardProps {
  exception: TripException
}

/**
 * One open exception or dispatcher note as a row (overhaul 2.1/2.4). A note is
 * information — grey; a driver-visible exception needs attention — amber, never red: it
 * is already recorded, and red would read as "something is broken right now". Tapping
 * expands the full description.
 */
export function ExceptionCard({ exception }: ExceptionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const note = isDispatcherNote(exception)
  const Icon = note ? MessageSquareText : TriangleAlert
  const title = note ? 'Note from dispatch' : exception.exception_type.replace(/_/g, ' ')

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((prev) => !prev)}
      className={cn(
        'flex w-full items-start gap-3 rounded-[18px] px-4 py-3.5 text-left transition-transform duration-150 active:scale-[0.99]',
        note ? 'bg-fill text-surface-on' : 'bg-attention-tint text-attention-ink',
      )}
    >
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface">
        <Icon className={cn('size-5', note ? 'text-surface-on' : 'text-attention')} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        {/* capitalize only for the snake_case type names; the note's title is already cased. */}
        <span className={cn('block text-headline', !note && 'capitalize')}>{title}</span>
        <span className={cn('block text-subhead', note ? 'text-surface-on-variant' : 'text-attention-ink', !expanded && 'line-clamp-1')}>
          {exception.description}
        </span>
      </span>
      <ChevronDown
        aria-hidden
        className={cn('mt-3 size-4 shrink-0 transition-transform duration-200', note ? 'text-outline' : 'text-attention', expanded && 'rotate-180')}
        strokeWidth={2.25}
      />
    </button>
  )
}
