'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { markTransition } from '@/lib/navigation/transition-direction'

interface SubpageHeaderProps {
  title: string
  backLabel?: string
  onBack?: () => void
  right?: ReactNode
  /** 'heading' (default): plain h1 for page names. 'reference': an identifier (trip ref). */
  titleVariant?: 'heading' | 'reference'
  /** What a 'reference' title is (e.g. "Trip reference"). Read to screen readers only. */
  titleCaption?: string
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
}: SubpageHeaderProps) {
  const router = useRouter()

  // Falls back to router.back() only when the caller has no explicit destination.
  function handleBack() {
    // The previous screen re-enters from the leading edge — the way this one came in.
    markTransition('back')
    if (onBack) onBack()
    else router.back()
  }

  return (
    // pt-safe clears the iOS status bar/notch on these full-bleed screens (no AppShell chrome).
    // Glass rather than an opaque bar: the header is sticky and content scrolls under it.
    <header className="glass-nav sticky top-0 z-sticky border-b border-outline-variant/25 px-4 pb-3 pt-safe">
      <div className="flex min-h-11 items-center justify-between gap-3 pt-1">
        {/* The current iOS back button: an ink chevron in a quiet round well, no text.
            HIG (Toolbars › Navigation) asks for the standard symbol rather than a "Back"
            label, and the blue chevron-plus-label read as a web link. The well is a light
            tone, not black: the old filled black pill outranked the page (audit H3). The
            destination still reaches screen readers through the accessible name. */}
        <button
          type="button"
          onClick={handleBack}
          aria-label={backLabel === DEFAULT_BACK_LABEL ? backLabel : `Back to ${backLabel}`}
          className="flex h-11 min-h-[44px] w-11 items-center justify-center rounded-full bg-surface-container-high text-surface-on transition-transform duration-100 active:scale-95 active:bg-surface-container-highest"
        >
          <ChevronLeft className="h-6 w-6 shrink-0 -translate-x-px" strokeWidth={2.25} aria-hidden />
        </button>
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
