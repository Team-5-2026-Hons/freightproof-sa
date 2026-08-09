// frontend/driver-pwa/components/layout/SubpageHeader.tsx
'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

interface SubpageHeaderProps {
  title: string
  backLabel?: string
  onBack?: () => void
  right?: ReactNode
  /**
   * How the title is presented.
   *
   * 'heading' (default) is the plain h1 the action screens use — "Log Checkpoint",
   * "Log Exception" are page names and read as headings.
   *
   * 'reference' renders the title as a bordered block on its own row underneath the
   * nav row, for screens whose title is an *identifier* rather than a page name. A
   * trip reference sat directly under the back pill was competing with it for the same
   * eyeline while being a completely different kind of thing; boxing it separates the
   * two and gives the code something to sit inside.
   */
  titleVariant?: 'heading' | 'reference'
  /** Caption above a 'reference' title (e.g. "Trip reference"). Ignored for 'heading'. */
  titleCaption?: string
}

// One consistent sticky header for non-handshake subpages (handshake steps keep using
// components/handshake/StepHeader, which also carries the panic shortcut). Previously
// five screens each hand-rolled their own back button — some sticky, some not, none
// meeting the 44px minimum touch target for a driver's gloved hand.
//
// Owns its own horizontal padding (like StepHeader does) — callers render it as the
// first child of an unpadded <main>, with the rest of the page's content in its own
// p-4 wrapper below, so the sticky glass-nav can span true full-bleed under the blur.
export function SubpageHeader({
  title,
  backLabel = 'Back',
  onBack,
  right,
  titleVariant = 'heading',
  titleCaption,
}: SubpageHeaderProps) {
  const router = useRouter()

  // Falls back to router.back() only if the caller has no explicit destination — every
  // current call site passes onBack so its own "where does this screen's back go" choice
  // is preserved exactly, per Task 8.
  function handleBack() {
    if (onBack) onBack()
    else router.back()
  }

  return (
    // pt-safe (app/globals.css) clears the iOS status bar: these screens are full-bleed
    // (lib/navigation/full-bleed.ts — no AppShell chrome above them), so top:0 here is
    // the true top of the device, which under viewportFit:'cover' sits behind the
    // notch/Dynamic Island. The 1rem that used to be pt-4 moves onto the inner row so
    // the inset and the visual padding stack instead of competing.
    // border-b hairline, not shadow-ambient-header: this header is sticky over a
    // scrolling page, so it does need a separation cue — but a 30px-blur drop shadow
    // painted a soft grey band right across the top of every trip screen, which on a
    // surface-tinted page reads as a mismatched second background rather than as depth.
    // A 1px rule does the same job (it tells you content passes underneath) and leaves
    // the page one continuous colour.
    <header className="glass-nav sticky top-0 z-sticky border-b border-outline-variant/25 px-4 pb-3 pt-safe">
      <div className="flex items-center justify-between gap-3 pt-4">
        <button
          onClick={handleBack}
          // Solid ink fill rather than the old bare blue text: on the glass-nav
          // background a plain text link was easy to miss and had no visible edge to
          // aim at. min-h-[44px] is still the gloved-hand touch minimum. No border —
          // it was border-primary on bg-primary, i.e. 2px of invisible ring eating the
          // pill's own internal space.
          //
          // rounded-xl, not rounded-full: as a full pill this was the only lozenge on a
          // screen made entirely of 14px-radius blocks, and at ~a third of the width it
          // read as a stray UI element rather than as part of the header. Sharing the
          // radius with the reference block below and the right-slot chip makes the
          // three read as one set — filled for the action, outlined for the labels.
          className="flex min-h-[44px] items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-on transition-opacity active:opacity-90"
        >
          ← {backLabel}
        </button>
        {right}
      </div>

      {titleVariant === 'reference' ? (
        // mt-3, and its own full-width row: dropping the identifier clear of the nav row
        // is what stops it reading as a caption on the back button.
        <div className="mt-3 rounded-xl border-2 border-primary bg-surface-container-lowest px-4 py-2.5">
          {titleCaption !== undefined && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant">
              {titleCaption}
            </p>
          )}
          {/* tracking-industrial: this is a machine reference read character-by-character
              when a driver reads it out over the phone, not a word read as a shape. */}
          <h1 className="text-lg font-bold tracking-industrial text-surface-on">{title}</h1>
        </div>
      ) : (
        <h1 className="mt-1 text-xl font-bold text-surface-on">{title}</h1>
      )}
    </header>
  )
}
