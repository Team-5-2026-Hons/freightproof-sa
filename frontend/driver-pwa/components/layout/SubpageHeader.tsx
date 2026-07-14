// frontend/driver-pwa/components/layout/SubpageHeader.tsx
'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

interface SubpageHeaderProps {
  title: string
  backLabel?: string
  onBack?: () => void
  right?: ReactNode
}

// One consistent sticky header for non-handshake subpages (handshake steps keep using
// components/handshake/StepHeader, which also carries the panic shortcut). Previously
// five screens each hand-rolled their own back button — some sticky, some not, none
// meeting the 44px minimum touch target for a driver's gloved hand.
//
// Owns its own horizontal padding (like StepHeader does) — callers render it as the
// first child of an unpadded <main>, with the rest of the page's content in its own
// p-4 wrapper below, so the sticky glass-nav can span true full-bleed under the blur.
export function SubpageHeader({ title, backLabel = 'Back', onBack, right }: SubpageHeaderProps) {
  const router = useRouter()

  // Falls back to router.back() only if the caller has no explicit destination — every
  // current call site passes onBack so its own "where does this screen's back go" choice
  // is preserved exactly, per Task 8.
  function handleBack() {
    if (onBack) onBack()
    else router.back()
  }

  return (
    <header className="glass-nav sticky top-0 z-sticky px-4 pb-3 pt-4 shadow-ambient-header">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={handleBack}
          className="flex min-h-[44px] items-center text-sm text-secondary"
        >
          ← {backLabel}
        </button>
        {right}
      </div>
      <h1 className="mt-1 text-xl font-bold text-surface-on">{title}</h1>
    </header>
  )
}
