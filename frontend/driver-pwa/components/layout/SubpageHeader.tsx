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

// Sticky header for non-step subpages (phase steps use components/phase/StepHeader).
// Owns its own horizontal padding — render as the first child of an unpadded <main>.
export function SubpageHeader({
  title,
  backLabel = 'Back',
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
        {/* The iOS back button: a tinted chevron plus where it goes, no fill. The old
            filled black "← My Trips" pill was the loudest object on every subpage,
            outranking the content it led away from (audit H3). -ml-2 optically aligns
            the chevron with the title's left edge; the hit area stays 44px tall. */}
        <button
          type="button"
          onClick={handleBack}
          className="-ml-2 flex min-h-[44px] items-center gap-0.5 rounded-lg pr-2 text-body text-secondary transition-opacity duration-100 active:opacity-50"
        >
          <ChevronLeft className="h-6 w-6 shrink-0" strokeWidth={2.25} aria-hidden />
          {backLabel}
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
