'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ROUTES } from '@/lib/constants/routes'

// Demo mode (default) verifies via AuthContext.signIn so the driver record
// lands on AuthContext.user before the (app) route guard checks it.
const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'

export default function OtpPage() {
  const router = useRouter()
  const auth = useContext(AuthContext)
  const params = useSearchParams()
  // Phone passed as query param from login page; empty string is safe — verifyOtp will fail gracefully.
  const phone = params.get('phone') ?? ''
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (isDemoMode) {
      await auth?.signIn({ phone_number: phone, otp: token })
      setLoading(false)
      // replace() so the user cannot navigate back to the OTP screen after login.
      router.replace(ROUTES.trips)
      return
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    })

    setLoading(false)

    if (verifyError) {
      setError(verifyError.message)
      return
    }

    // replace() so the user cannot navigate back to the OTP screen after login.
    router.replace(ROUTES.trips)
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
          maxLength={6}
          value={token}
          // Strip non-digit characters to prevent invalid OTP submission.
          onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
          required
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" loading={loading} disabled={loading || token.length < 6}>
          {loading ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
    </main>
  )
}
