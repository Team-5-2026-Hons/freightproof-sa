'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'

interface StepHeaderProps {
  handshakeName: string
  stepName: string
  stepIndex: number   // 1-based
  totalSteps: number
}

export function StepHeader({ handshakeName, stepName, stepIndex, totalSteps }: StepHeaderProps) {
  const router = useRouter()
  // StepHeader only ever renders inside /trip/handshake/[h]/step/[slug] (see every
  // H*.tsx step component) — reading the handshake number from the route here, rather
  // than threading a new prop through all ~20 step components, keeps this a one-file fix.
  const { h } = useParams<{ h: string }>()
  const handshakeNum = Number(h) as 1 | 2 | 3 | 4 | 5
  const progress = (stepIndex / totalSteps) * 100

  // Mid-handshake (not the first step): back goes to the previous step of the SAME
  // handshake, not out of it entirely — the old behavior exited the whole handshake from
  // every step, discarding the driver's place. Drafts persist in localStorage
  // (useHandshakeDraft), so stepping back and forward again is always safe.
  function handleBack() {
    if (stepIndex > 1) {
      const slugs = STEP_SLUGS[handshakeNum]
      router.push(ROUTES.handshakeStep(handshakeNum, slugs[stepIndex - 2]))
    } else {
      router.push(ROUTES.activeTripDetail)
    }
  }

  const backLabel = stepIndex > 1 ? 'Back to previous step' : 'Back to trip'

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
          {stepIndex}/{totalSteps}
        </span>
        {/* A driver under threat mid-handshake (gate, loading bay) must reach panic
            without first backing out to the trip hub. Plain button rather than
            IconButton: cn() doesn't merge Tailwind conflicts, so IconButton's
            default text colour could override text-error. h-11/w-11 = 44px, the
            minimum touch target for a stressed, gloved hand. */}
        <button
          onClick={() => router.push(ROUTES.panic)}
          aria-label="Emergency — open panic alert"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-error transition-colors hover:bg-error-container/40 active:scale-95"
        >
          <ShieldAlert className="h-5 w-5" strokeWidth={2} aria-hidden />
        </button>
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
