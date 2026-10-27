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

const WELCOME_IMAGE_SRC = '/images/welcome-truck.webp'

const WELCOME_MARK_SIZE_PX = 52

export default function WelcomePage() {
  const router = useRouter()
  useStatusBarOverride('dark')
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null)
  useEffect(() => {
    const reason = consumeSignedOutReason()
    if (reason !== null) setSignedOutReason(reason)
  }, [])

  return (
    <div className="dark">
      <main className="relative flex min-h-dvh flex-col overflow-hidden bg-surface text-surface-on">
        <div className="auth-dusk absolute inset-0" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WELCOME_IMAGE_SRC}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
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
            <p className="text-center text-footnote text-surface-on-variant">
              New driver? Your dispatcher sets up your account.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
