'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { CountryCodeSelect } from '@/components/ui/CountryCodeSelect'
import { AuthFrame, AuthHeading, AUTH_PILL, AUTH_PRIMARY_PILL } from '@/components/auth/AuthFrame'
import { ROUTES } from '@/lib/constants/routes'
import { DEFAULT_COUNTRY_CODE, type CountryCode } from '@/lib/constants/country-codes'
import { groupNationalNumber } from '@/lib/utils/format-phone'


// Supabase's error message when shouldCreateUser: false blocks an unregistered
// phone number — matched case-insensitively to surface a driver-friendly message.
const UNREGISTERED_PHONE_ERROR_FRAGMENT = 'signups not allowed'

// Loose E.164 check on the combined number: + then 7-15 digits.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/

// Drivers type the national format with a leading trunk '0' (e.g. 0810463076)
// — strip exactly one so it isn't duplicated alongside the dial code.
function toE164(dialCode: string, localNumber: string): string {
  return dialCode + localNumber.replace(/^0/, '')
}

export default function PhoneLoginPage() {
  const router = useRouter()
  const auth = useContext(AuthContext)
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY_CODE)
  const [localNumber, setLocalNumber] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleLocalNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    // type="tel" doesn't restrict input — strip non-digits as the driver types.
    setLocalNumber(e.target.value.replace(/\D/g, ''))
  }

  // Continue only validates and asks "is this you?" — nothing is sent yet. A WhatsApp
  // code fired at a mistyped number is a wasted send, a cooldown, and a driver stuck at
  // the gate; one look at their own number, large, catches the typo first.
  function handleContinue(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!PHONE_PATTERN.test(toE164(country.dialCode, localNumber))) {
      setError('Enter a valid phone number, e.g. 0821234567.')
      return
    }

    setConfirming(true)
  }

  async function handleConfirm() {
    // The sheet steps aside and the spinner moves into Continue: the screen the driver
    // returns to says what is happening, rather than a sheet sitting over a busy page.
    setConfirming(false)
    setLoading(true)

    const phone = toE164(country.dialCode, localNumber)

    try {
      await auth?.requestOtp(phone)
      router.push(`/otp?phone=${encodeURIComponent(phone)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP.'
      setError(
        message.toLowerCase().includes(UNREGISTERED_PHONE_ERROR_FRAGMENT)
          ? 'Phone number not registered — contact your dispatcher.'
          : message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthFrame onBack={() => router.push(ROUTES.login)} backLabel="Back to welcome">
      <AuthHeading title="Welcome Back">
        Enter the phone number linked to your FreightProof driver account.
      </AuthHeading>

      <form onSubmit={handleContinue} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {/* Visually hidden, not removed: the fields are self-evident on sight (flag,
              dial code, a number-shaped placeholder), but VoiceOver needs the name. */}
          <label htmlFor="phone-local-number" className="sr-only">
            Phone number
          </label>
          <div className="flex gap-2">
            <CountryCodeSelect value={country} onChange={setCountry} />
            <input
              id="phone-local-number"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder={country.placeholder}
              value={localNumber}
              onChange={handleLocalNumberChange}
              required
              className={[
                // text-body is 1rem = 16px at default Dynamic Type: at or above the size
                // below which iOS zooms the page on focus (see components/ui/Input.tsx).
                'h-14 min-w-0 flex-1 rounded-2xl px-5 text-body tabular-nums text-surface-on',
                'bg-surface-container-high',
                'placeholder:text-surface-on-variant/80',
                'outline-none ring-inset focus:ring-2 focus:ring-surface-on/40',
                'transition-shadow duration-150',
              ].join(' ')}
            />
          </div>
          {error && (
            <p role="alert" className="text-footnote font-medium text-error">
              {error}
            </p>
          )}
        </div>

        {/* "Continue", not "Send Code": tapping it sends nothing until the number is
            confirmed. While sending, the label says what is actually happening. */}
        <Button
          type="submit"
          size="lg"
          className={AUTH_PRIMARY_PILL}
          loading={loading}
          disabled={loading || !localNumber}
        >
          {loading ? 'Sending Code…' : 'Continue'}
        </Button>
      </form>

      <Drawer open={confirming} onClose={() => setConfirming(false)} side="bottom" title="Is This Your Number?">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="flex items-center gap-2 text-title-1 tabular-nums text-surface-on">
            <span aria-hidden>{country.flag}</span>
            <span>
              {country.dialCode} {groupNationalNumber(localNumber)}
            </span>
          </p>
          <p className="text-body text-surface-on-variant">
            We&apos;ll send a sign-in code to it on WhatsApp.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <Button size="lg" className={AUTH_PRIMARY_PILL} onClick={() => void handleConfirm()}>
            Confirm
          </Button>
          <Button size="lg" variant="secondary" className={AUTH_PILL} onClick={() => setConfirming(false)}>
            Go Back
          </Button>
        </div>
      </Drawer>
    </AuthFrame>
  )
}
