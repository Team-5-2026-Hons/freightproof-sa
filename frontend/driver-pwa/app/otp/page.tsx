'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { Suspense, useContext, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { OtpInput } from '@/components/ui/OtpInput'
import { AuthFrame, AuthHeading, AUTH_PILL, AUTH_PRIMARY_PILL } from '@/components/auth/AuthFrame'
import { ROUTES } from '@/lib/constants/routes'
import { takeReturnPath } from '@shared/lib/session/return-path'
import { formatPhoneForDisplay } from '@/lib/utils/format-phone'


// Kept in step with AuthContext's own list — see that file for why '/otp' isn't in ROUTES.
const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

const OTP_LENGTH = 6


// Cooldown between OTP sends, so drivers can't hammer the WhatsApp sandbox.
// It starts on page load too: the login page just sent the first OTP before
// navigating here, so an immediate resend would be a duplicate.
const RESEND_COOLDOWN_S = 30

// useSearchParams() opts a page out of static rendering unless wrapped in
// Suspense — required for the static export (output: 'export') build.
export default function OtpPage() {
  return (
    <Suspense
      fallback={
        // Inside the dark frame too, so the flow never flashes light between screens.
        <AuthFrame className="items-center justify-center">
          <p className="text-sm text-surface-on-variant">Loading…</p>
        </AuthFrame>
      }
    >
      <OtpForm />
    </Suspense>
  )
}

function OtpForm() {
  const router = useRouter()
  const auth = useContext(AuthContext)
  const params = useSearchParams()
  // Phone passed as query param from login page; empty string is safe — signIn will fail gracefully.
  const phone = params.get('phone') ?? ''
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  // Separate from `loading` so an in-flight resend doesn't disable Verify.
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)

  // One interval per cooldown run — keyed on active/inactive rather than the
  // countdown value so each tick doesn't tear the interval down and recreate it.
  const cooldownActive = cooldown > 0
  useEffect(() => {
    if (!cooldownActive) return

    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1_000)
    return () => clearInterval(id)
  }, [cooldownActive])

  // Takes the code as an argument (not from state) because auto-submit fires
  // from onChange, before the setToken state update has rendered.
  async function verify(code: string) {
    setLoading(true)
    setError(null)

    try {
      await auth?.signIn({ phone_number: phone, otp: code })
      // Send the driver back to whatever guarded screen they were bounced from (idle
      // expiry or a silently-expired token) when there is one; otherwise the usual
      // default landing page. replace() so the user cannot navigate back to the OTP
      // screen after login.
      const returnTo = takeReturnPath(window.localStorage, AUTH_ROUTE_PREFIXES)
      router.replace(returnTo ?? ROUTES.trips)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify OTP.')
    } finally {
      setLoading(false)
    }
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    void verify(token)
  }

  function handleTokenChange(value: string) {
    setToken(value)
    // Auto-submit the moment the 6th digit lands — one less tap for the driver.
    // `loading` guards double-fire: further change events during an in-flight
    // verify are ignored.
    if (value.length === OTP_LENGTH && !loading) {
      void verify(value)
    }
  }

  async function handleResend() {
    setResending(true)
    setError(null)

    try {
      await auth?.requestOtp(phone)
      // Restart the cooldown only after a successful send — a failed request
      // should be retryable immediately.
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend OTP.')
    } finally {
      setResending(false)
    }
  }

  return (
    // Same dark frame, back button and large heading as the phone screen it follows, so
    // the sign-in reads as one flow. Back goes to phone entry, where a mistyped number
    // is fixed — the same place "Use a Different Number" goes.
    <AuthFrame onBack={() => router.push(ROUTES.loginPhone)} backLabel="Back to phone number">
      {/* "Code", not "OTP" — the same word the rest of the flow uses. */}
      <AuthHeading title="Enter the Code">
        {/* A refresh or a link can land here without the number; never "Sent to on WhatsApp." */}
        {phone ? (
          <>Sent to <span className="tabular-nums">{formatPhoneForDisplay(phone)}</span> on WhatsApp.</>
        ) : (
          'Sent to your phone on WhatsApp.'
        )}
      </AuthHeading>

      <form onSubmit={handleVerify} className="mt-8 flex flex-col gap-4">
        <OtpInput length={OTP_LENGTH} value={token} onChange={handleTokenChange} autoFocus />
        {error && <p className="text-center text-footnote font-medium text-error">{error}</p>}
        <Button
          type="submit"
          size="lg"
          className={AUTH_PRIMARY_PILL}
          loading={loading}
          disabled={loading || token.length < OTP_LENGTH}
        >
          {loading ? 'Verifying…' : 'Verify'}
        </Button>
        {/* The two ways out as outlined pills under the main action, full width and
            stacked: side by side they don't fit a phone's width and each wrapped onto two
            lines. Same width as Verify so the three read as one column of controls. */}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className={AUTH_PILL}
            loading={resending}
            disabled={cooldownActive || resending}
            onClick={handleResend}
          >
            {cooldownActive ? `Resend in ${cooldown}s` : 'Resend Code'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className={AUTH_PILL}
            onClick={() => router.push(ROUTES.loginPhone)}
          >
            Use a Different Number
          </Button>
        </div>
      </form>
    </AuthFrame>
  )
}
