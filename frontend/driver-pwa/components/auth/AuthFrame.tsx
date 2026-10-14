'use client'

import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStatusBarOverride } from '@/lib/hooks/useStatusBarOverride'

interface AuthFrameProps {
  /** Shows the round back button when given. */
  onBack?: () => void
  /** Accessible name for the back button — where it goes, e.g. "Back to sign-in". */
  backLabel?: string
  className?: string
  children: ReactNode
}

// The sign-in flow's own frame: always dark, whatever the driver's theme setting.
//
// Why a scoped `dark` class rather than flipping the theme: every --fp-* token (and the
// shadcn ones CountryCodeSelect/OtpInput read) is redefined on `.dark`, a class selector,
// so putting it on this wrapper re-points the whole subtree at the dark palette without
// touching <html> — the driver's Light/Dark/Auto choice still governs the app after
// sign-in, and ThemeManager has nothing to fight. The sign-in screens are always dark so
// the flow reads as one continuous, deliberate surface from the photo welcome onward.
export function AuthFrame({ onBack, backLabel = 'Back', className, children }: AuthFrameProps) {
  // The scoped class can't reach the native status bar; this keeps its glyphs light.
  useStatusBarOverride('dark')
  return (
    <div className="dark">
      <main
        className={cn(
          'flex min-h-dvh flex-col bg-surface px-6 text-surface-on',
          'pt-safe pb-[max(env(safe-area-inset-bottom),1.5rem)]',
          className,
        )}
      >
        {onBack && (
          // Same round ink well as SubpageHeader's back button, so the control a driver
          // learns here is the one they meet on every screen after sign-in.
          <div className="pt-2">
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high text-surface-on transition-transform duration-100 active:scale-95 active:bg-surface-container-highest"
            >
              <ChevronLeft className="h-6 w-6 -translate-x-px" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}

interface AuthHeadingProps {
  title: string
  children?: ReactNode
}

/** Large left-aligned title with an optional line of context under it. */
export function AuthHeading({ title, children }: AuthHeadingProps) {
  return (
    <div className="mt-6">
      <h1 className="text-large-title text-surface-on">{title}</h1>
      {children && <p className="mt-2 text-body text-surface-on-variant">{children}</p>}
    </div>
  )
}

// Fully rounded, like the rest of the sign-in flow. Exported so login, OTP and the
// confirm sheet apply one shape to Button rather than three spellings of it.
export const AUTH_PILL = 'rounded-full'

// The flow's one bright object: a pure white pill with black text. The dark theme's own
// primary is a soft grey (#dcd9de), right for in-app buttons but flat against this black
// frame. Literal white/black rather than tokens because this frame is dark by definition.
// aria-busy keeps it white while sending — `loading` also disables the button, and the
// grey disabled look would read as "can't tap yet" mid-send. (aria-* variants are emitted
// after :disabled at equal specificity, so they win.)
export const AUTH_PRIMARY_PILL =
  'rounded-full bg-white text-black hover:opacity-90 aria-busy:bg-white aria-busy:text-black'
