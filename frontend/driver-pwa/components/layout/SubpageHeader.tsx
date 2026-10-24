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
  /**
   * 'heading' (default): plain h1 for page names. 'reference': an identifier (trip ref).
   * 'bar': the title centred in the bar beside the back button, iOS-inline — for forms
   * whose body opens with its own large question.
   */
  titleVariant?: 'heading' | 'reference' | 'bar'
  /** What a 'reference' title is (e.g. "Trip reference"). Read to screen readers only. */
  titleCaption?: string
  /**
   * A second line under the title (e.g. the trip reference). When given, the title and it
   * sit centred in the bar beside the back button — the iOS inline title with subtitle —
   * instead of a heading block below it. For screens whose content needs the height, like
   * In Transit's map.
   */
  subtitle?: string
}

const DEFAULT_BACK_LABEL = 'Back'

// Sticky header for non-step subpages (phase steps use components/phase/StepHeader).
// Owns its own horizontal padding — render as the first child of an unpadded <main>.
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

  // Falls back to router.back() only when the caller has no explicit destination.
  function handleBack() {
    // The previous screen re-enters from the leading edge — the way this one came in.
    markTransition('back')
    if (onBack) onBack()
    else router.back()
  }
  // The left-edge swipe performs this same action (app/(app)/template.tsx).
  useEdgeBackHandler(handleBack)

  const backButton = (
    // The current iOS back button: an ink chevron in a quiet round well, no text. HIG
    // (Toolbars › Navigation) asks for the standard symbol rather than a "Back" label, and
    // the blue chevron-plus-label read as a web link. The well is a light tone, not black:
    // the old filled black pill outranked the page. The destination still
    // reaches screen readers through the accessible name.
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
        {/* Three columns, the outer two the same width, so the title block is centred on
            the screen rather than in whatever space the back button leaves. */}
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
    // pt-safe clears the iOS status bar/notch on these full-bleed screens (no AppShell chrome).
    // Glass rather than an opaque bar: the header is sticky and content scrolls under it.
    // The hairline appears only once content scrolls beneath the bar (scroll edge, not a
    // permanent divider).
    <header className={headerClass}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 pt-1">
        {backButton}
        {right}
      </div>

      {titleVariant === 'reference' ? (
        <>
          {/* No visible caption above the identifier: it reads as a trip reference on
              sight, and a label stacked over a heading is noise. Screen readers still get
              the context. */}
          {titleCaption !== undefined && <p className="sr-only">{titleCaption}</p>}
          {/* Monospace + tabular digits so a reference reads character by character —
              this is the string a driver reads aloud to dispatch. */}
          <h1 className="mt-1 font-mono text-title-2 tabular-nums text-surface-on">{title}</h1>
        </>
      ) : (
        <h1 className="mt-1 text-title-2 text-surface-on">{title}</h1>
      )}
    </header>
  )
}
