'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { Suspense, useContext, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ROUTES } from '@/lib/constants/routes'

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
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-surface-on-variant">Loading…</p>
        </main>
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
      // replace() so the user cannot navigate back to the OTP screen after login.
      router.replace(ROUTES.trips)
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

  function handleTokenChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip non-digit characters to prevent invalid OTP submission.
    const cleaned = e.target.value.replace(/\D/g, '')
    setToken(cleaned)
    // Auto-submit the moment the 6th digit lands — one less tap for the driver.
    // `loading` guards double-fire: further change events during an in-flight
    // verify are ignored.
    if (cleaned.length === OTP_LENGTH && !loading) {
      void verify(cleaned)
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
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-2 text-surface-on">Enter OTP</h1>
      <p className="text-sm text-surface-on-variant mb-8">Sent to {phone}</p>
      <form onSubmit={handleVerify} className="w-full max-w-sm flex flex-col gap-4">
        <Input
          label="6-digit code"
          type="text"
          inputMode="numeric"
          maxLength={OTP_LENGTH}
          value={token}
          onChange={handleTokenChange}
          required
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" loading={loading} disabled={loading || token.length < OTP_LENGTH}>
          {loading ? 'Verifying…' : 'Verify'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          loading={resending}
          disabled={cooldownActive || resending}
          onClick={handleResend}
        >
          {cooldownActive ? `Resend in ${cooldown}s` : 'Resend code'}
        </Button>
        {/* Full-width to match its ghost sibling (Resend code) above it, rather than
            the old centered small-text link — both are now the same shadcn Button. */}
        <Button type="button" variant="ghost" onClick={() => router.push(ROUTES.login)}>
          Wrong number? Go back
        </Button>
      </form>
    </main>
  )
}
