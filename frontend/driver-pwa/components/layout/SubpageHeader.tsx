'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

interface SubpageHeaderProps {
  title: string
  backLabel?: string
  onBack?: () => void
  right?: ReactNode
  /** 'heading' (default): plain h1 for page names. 'reference': boxed row for identifiers. */
  titleVariant?: 'heading' | 'reference'
  /** Caption above a 'reference' title (e.g. "Trip reference"). Ignored for 'heading'. */
  titleCaption?: string
}

// Sticky header for non-handshake subpages (handshake steps use components/handshake/StepHeader).
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
    if (onBack) onBack()
    else router.back()
  }

  return (
    // pt-safe clears the iOS status bar/notch on these full-bleed screens (no AppShell chrome).
    // border-b hairline, not shadow-ambient-header, to avoid a mismatched shadow band on tinted pages.
    <header className="glass-nav sticky top-0 z-sticky border-b border-outline-variant/25 px-4 pb-3 pt-safe">
      <div className="flex items-center justify-between gap-3 pt-4">
        <button
          onClick={handleBack}
          // Solid fill + min-h-[44px] for a gloved-hand touch target; rounded-xl matches
          // the reference block/chip radius set below.
          className="flex min-h-[44px] items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-on transition-opacity active:opacity-90"
        >
          ← {backLabel}
        </button>
        {right}
      </div>

      {titleVariant === 'reference' ? (
        <div className="mt-3 rounded-xl border-2 border-primary bg-surface-container-lowest px-4 py-2.5">
          {titleCaption !== undefined && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant">
              {titleCaption}
            </p>
          )}
          <h1 className="text-lg font-bold tracking-industrial text-surface-on">{title}</h1>
        </div>
      ) : (
        <h1 className="mt-1 text-xl font-bold text-surface-on">{title}</h1>
      )}
    </header>
  )
}
