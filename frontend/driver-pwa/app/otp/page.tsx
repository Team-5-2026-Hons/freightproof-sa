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


const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

const OTP_LENGTH = 6


const RESEND_COOLDOWN_S = 30

export default function OtpPage() {
  return (
    <Suspense
      fallback={
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
  const phone = params.get('phone') ?? ''
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)

  const cooldownActive = cooldown > 0
  useEffect(() => {
    if (!cooldownActive) return

    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1_000)
    return () => clearInterval(id)
  }, [cooldownActive])

  async function verify(code: string) {
    setLoading(true)
    setError(null)

    try {
      await auth?.signIn({ phone_number: phone, otp: code })
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
    if (value.length === OTP_LENGTH && !loading) {
      void verify(value)
    }
  }

  async function handleResend() {
    setResending(true)
    setError(null)

    try {
      await auth?.requestOtp(phone)
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend OTP.')
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthFrame onBack={() => router.push(ROUTES.loginPhone)} backLabel="Back to phone number">
      <AuthHeading title="Enter the Code">
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
