'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { CountryCodeSelect } from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY_CODE, type CountryCode } from '@/lib/constants/country-codes'

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

export default function LoginPage() {
  const router = useRouter()
  const auth = useContext(AuthContext)
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY_CODE)
  const [localNumber, setLocalNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleLocalNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    // type="tel" doesn't restrict input — strip non-digits as the driver types.
    setLocalNumber(e.target.value.replace(/\D/g, ''))
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const phone = toE164(country.dialCode, localNumber)
    if (!PHONE_PATTERN.test(phone)) {
      setError('Enter a valid phone number, e.g. 0821234567.')
      return
    }

    setLoading(true)

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
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-8 text-surface-on">FreightProof Driver</h1>
      <form onSubmit={handleSendOtp} className="w-full max-w-sm flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="phone-local-number"
            className="text-xs font-bold uppercase tracking-wider text-surface-on-variant"
          >
            Phone number
          </label>
          <div className="flex gap-2">
            <CountryCodeSelect value={country} onChange={setCountry} />
            <input
              id="phone-local-number"
              type="tel"
              inputMode="numeric"
              placeholder={country.placeholder}
              value={localNumber}
              onChange={handleLocalNumberChange}
              required
              className={[
                'flex-1 rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
                'bg-surface-container-low border border-outline-variant/30',
                'placeholder:text-surface-on-variant/50',
                'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
                'transition-colors duration-150 min-h-[44px]',
              ].join(' ')}
            />
          </div>
          {error && <p className="text-xs text-error font-medium">{error}</p>}
        </div>
        <Button type="submit" loading={loading} disabled={loading || !localNumber}>
          {loading ? 'Sending…' : 'Send OTP'}
        </Button>
      </form>
    </main>
  )
}
