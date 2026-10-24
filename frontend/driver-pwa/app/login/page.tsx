'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/brand/LogoMark'
import { AUTH_PRIMARY_PILL } from '@/components/auth/AuthFrame'
import { ROUTES } from '@/lib/constants/routes'
import { useStatusBarOverride } from '@/lib/hooks/useStatusBarOverride'
import { consumeSignedOutReason } from '@/lib/session/signed-out-reason'

// Full-bleed hero photo, served from public/.
//
// Photo: Giovanni Spoletini, "A White Truck on the Road", Pexels (photo 12261472),
// https://www.pexels.com/photo/a-white-truck-on-the-road-12261472/ — Pexels License: free
// for use in apps, editing allowed, no attribution required (credited here anyway).
// Chosen because it is already phone-shaped (9:16) and its composition matches the
// screen: open storm sky behind the lockup, truck mid-frame, road under the button.
// Resized to 1440px wide (≈3x a 430pt-wide iPhone) and re-encoded as WebP (~160 KB).
const WELCOME_IMAGE_SRC = '/images/welcome-truck.webp'

// Mark edge in px; the wordmark scales from it (see Logo). Display size: on this screen
// the lockup IS the headline, the way a bank app's welcome screen leads with its name.
const WELCOME_MARK_SIZE_PX = 52

export default function WelcomePage() {
  const router = useRouter()
  // The photo is dark at the top whatever the theme, so the status-bar glyphs stay light.
  useStatusBarOverride('dark')
  // Read in an effect: sessionStorage doesn't exist during the static prerender.
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null)
  useEffect(() => {
    const reason = consumeSignedOutReason()
    if (reason !== null) setSignedOutReason(reason)
  }, [])

  return (
    // Always dark (see AuthFrame for the scoped-class mechanism). Not AuthFrame itself:
    // this screen is full-bleed artwork with no back button and no padded column.
    <div className="dark">
      <main className="relative flex min-h-dvh flex-col overflow-hidden bg-surface text-surface-on">
        <div className="auth-dusk absolute inset-0" aria-hidden />
        {/* A plain <img>: static export has no next/image optimiser at runtime.
            Decorative — the lockup and the button carry everything the screen says. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WELCOME_IMAGE_SRC}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Scrims, top and bottom, so the white lockup and the button read over any
            photo — including a bright sky — without a box behind either. */}
        <div
          className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent via-40% to-black/80"
          aria-hidden
        />

        <div className="relative flex flex-1 flex-col px-6 pt-safe pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          <h1 className="mt-16 flex justify-center">
            <Logo size={WELCOME_MARK_SIZE_PX} />
          </h1>

          <div className="mt-auto flex flex-col gap-4">
            {signedOutReason !== null && (
              <p role="status" className="rounded-xl bg-surface-container-high px-4 py-3 text-center text-subhead text-surface-on">
                {signedOutReason}
              </p>
            )}
            <Button size="lg" className={AUTH_PRIMARY_PILL} onClick={() => router.push(ROUTES.loginPhone)}>
              Log In
            </Button>
            {/* Where a bank app offers "Create account": drivers can't sign themselves
                up — dispatch registers them — so this says where an account comes from
                instead of leaving a new driver hunting for a button that doesn't exist. */}
            <p className="text-center text-footnote text-surface-on-variant">
              New driver? Your dispatcher sets up your account.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
