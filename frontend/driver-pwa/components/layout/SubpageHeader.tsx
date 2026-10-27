'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useScrolledPastTop } from '@/lib/hooks/useScrolledPastTop'
import { useEdgeBackHandler } from '@/lib/navigation/edge-back'
import { cn } from '@/lib/utils'

interface SubpageHeaderProps {
  title: string
  backLabel?: string
  onBack?: () => void
  right?: ReactNode
  titleVariant?: 'heading' | 'reference' | 'bar'
  titleCaption?: string
  subtitle?: string
}

const DEFAULT_BACK_LABEL = 'Back'

export function SubpageHeader({
  title,
  backLabel = DEFAULT_BACK_LABEL,
  onBack,
  right,
  titleVariant = 'heading',
  titleCaption,
  subtitle,
}: SubpageHeaderProps) {
  const router = useRouter()
  const scrolled = useScrolledPastTop()

  function handleBack() {
    markTransition('back')
    if (onBack) onBack()
    else router.back()
  }
  useEdgeBackHandler(handleBack)

  const backButton = (
    <button
      type="button"
      onClick={handleBack}
      aria-label={backLabel === DEFAULT_BACK_LABEL ? backLabel : `Back to ${backLabel}`}
      className="flex h-11 min-h-[44px] w-11 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-surface-on transition-transform duration-100 active:scale-95 active:bg-surface-container-highest"
    >
      <ChevronLeft className="h-6 w-6 shrink-0 -translate-x-px" strokeWidth={2.25} aria-hidden />
    </button>
  )

  const headerClass = cn(
    'glass-nav sticky top-0 z-sticky border-b px-4 pb-3 pt-safe transition-[border-color] duration-200',
    scrolled ? 'border-outline-variant/25' : 'border-transparent',
  )

  if (subtitle !== undefined || titleVariant === 'bar') {
    return (
      <header className={headerClass}>
        <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 pt-1">
          {backButton}
          <div className="min-w-0 text-center">
            <h1 className="truncate text-headline text-surface-on">{title}</h1>
            {subtitle !== undefined && <p className="truncate text-footnote tabular-nums text-surface-on-variant">{subtitle}</p>}
          </div>
          <div className="flex justify-end">{right}</div>
        </div>
      </header>
    )
  }

  return (
    <header className={headerClass}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 pt-1">
        {backButton}
        {right}
      </div>

      {titleVariant === 'reference' ? (
        <>
          {titleCaption !== undefined && <p className="sr-only">{titleCaption}</p>}
          <h1 className="mt-1 font-mono text-title-2 tabular-nums text-surface-on">{title}</h1>
        </>
      ) : (
        <h1 className="mt-1 text-title-2 text-surface-on">{title}</h1>
      )}
    </header>
  )
}
