'use client'

import { useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import { useStepIndicator } from '@/lib/hooks/useStepIndicator'
import { ROUTES } from '@/lib/constants/routes'
import { IconButton } from '@/components/ui/IconButton'

interface StepHeaderProps {
  handshake: HandshakeNumber
  step: number   // 1-based
}

export function StepHeader({ handshake, step }: StepHeaderProps) {
  const router = useRouter()
  // Labels/counts are derived from shared handshake metadata via this hook, rather
  // than passed in as props, so every step component's header stays in sync with a
  // single source of truth (STEP_NAMES/HANDSHAKE_STEP_COUNTS in @shared).
  const { handshakeName, stepName, current, total } = useStepIndicator(handshake, step)
  const progress = (current / total) * 100

  // Mid-handshake (not the first step): back goes to the previous step of the SAME
  // handshake, not out of it entirely — the old behavior exited the whole handshake from
  // every step, discarding the driver's place. Drafts persist in localStorage
  // (useHandshakeDraft), so stepping back and forward again is always safe.
  function handleBack() {
    if (current > 1) {
      const slugs = STEP_SLUGS[handshake as 1 | 2 | 3 | 4 | 5]
      router.push(ROUTES.handshakeStep(handshake as 1 | 2 | 3 | 4 | 5, slugs[current - 2]))
    } else {
      router.push(ROUTES.activeTripDetail)
    }
  }

  const backLabel = current > 1 ? 'Back to previous step' : 'Back to trip'

  return (
    <header className="sticky top-0 z-sticky bg-surface pb-3 pt-4 px-4 shadow-ambient-header">
      <div className="mb-3 flex items-center gap-3">
        {/* -ml-3 keeps the arrow visually aligned with the header edge while the
            h-11/w-11 box meets the same 44px touch minimum as the panic button. */}
        <button
          onClick={handleBack}
          aria-label={backLabel}
          className="-ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm text-secondary transition-colors hover:bg-secondary/10 active:scale-95"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-surface-on-variant truncate">{handshakeName}</p>
          <p className="text-base font-semibold leading-tight truncate">{stepName}</p>
        </div>
        <span className="text-xs text-surface-on-variant tabular-nums">
          {current}/{total}
        </span>
        {/* A driver under threat mid-handshake (gate, loading bay) must reach panic
            without first backing out to the trip hub. IconButton (size="md" = 44px,
            the minimum touch target for a stressed, gloved hand): its cn() uses
            tailwind-merge, which resolves the text-error/hover:bg-error-container
            override against IconButton's own default text/hover classes correctly,
            so there's no risk of the default color winning instead. */}
        <IconButton
          icon={<ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />}
          onClick={() => router.push(ROUTES.panic)}
          aria-label="Emergency — open panic alert"
          className="text-error hover:bg-error-container/40"
        />
      </div>
      <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
        <div
          className="h-full rounded-full bg-secondary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  )
}
