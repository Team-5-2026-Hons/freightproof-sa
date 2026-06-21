'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone,
      options: { channel: 'sms' },
    })

    setLoading(false)

    if (otpError) {
      setError(otpError.message)
      return
    }

    // Pass phone via query param so OTP page can display it and use it for verification.
    router.push(`/otp?phone=${encodeURIComponent(phone)}`)
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-8">FreightProof Driver</h1>
      <form onSubmit={handleSendOtp} className="w-full max-w-sm flex flex-col gap-4">
        <Input
          label="Phone number"
          type="tel"
          placeholder="+27 82 000 0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" loading={loading} disabled={loading || !phone}>
          {loading ? 'Sending…' : 'Send OTP'}
        </Button>
      </form>
    </main>
  )
}
