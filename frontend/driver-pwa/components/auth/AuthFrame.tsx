'use client'

import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStatusBarOverride } from '@/lib/hooks/useStatusBarOverride'

interface AuthFrameProps {
  /** Shows the round back button when given. */
  onBack?: () => void
  backLabel?: string
  className?: string
  children: ReactNode
}

export function AuthFrame({ onBack, backLabel = 'Back', className, children }: AuthFrameProps) {
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

export const AUTH_PILL = 'rounded-full'

export const AUTH_PRIMARY_PILL =
  'rounded-full bg-white text-black hover:opacity-90 aria-busy:bg-white aria-busy:text-black'
