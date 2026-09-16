'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/hooks/useAuth'
import { ProfileUnavailableError } from '@/lib/context/AuthContext'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'

// Shown for a rejected email/password and for a submit with a field left blank — from
// the form's point of view both are "these details are not usable", and naming which
// field is wrong is exactly the hint a credential-stuffer wants.
const INVALID_CREDENTIALS = 'Invalid credentials'

export default function LoginPage() {
  const router = useRouter()
  const { signIn, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  // A rejected credential is a property of the two fields, so it marks them. Anything
  // else — the backend being unreachable — is a property of the attempt, and repeating a
  // full sentence about it under both inputs would read as two separate faults.
  const isCredentialError = error === INVALID_CREDENTIALS

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      setError(INVALID_CREDENTIALS)
      triggerShake()
      return
    }

    try {
      // signIn resolves only once the profile is loaded, so the guard on the route we are
      // pushing to will already see an authenticated user — see AuthContext.signIn.
      await signIn({ email, password })
      router.push(ROUTES.home)
    } catch (err) {
      setError(err instanceof ProfileUnavailableError ? err.message : INVALID_CREDENTIALS)
      triggerShake()
    }
  }

  const triggerShake = () => {
    setShaking(true)
    setTimeout(() => setShaking(false), 600)
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-surface px-4">
      <Card
        className={cn(
          'w-full max-w-md p-8',
          shaking && 'animate-shake',
        )}
      >
        <div className="flex flex-col items-center gap-2 mb-8">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-primary">
            <Shield className="w-7 h-7 text-primary-on" />
          </span>
          <h1 className="text-2xl font-extrabold text-surface-on">FreightProof SA</h1>
          <p className="text-sm text-surface-on-variant">Dispatcher Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            inputMode="email"
            placeholder="dispatcher@linbroexpress.co.za"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(null) }}
            error={isCredentialError ? error : undefined}
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }}
            error={isCredentialError ? error : undefined}
            autoComplete="current-password"
          />
          {error && !isCredentialError && (
            <p role="alert" className="text-xs text-error font-medium">{error}</p>
          )}
          <Button type="submit" loading={isLoading} className="mt-2">
            Sign In
          </Button>
        </form>
      </Card>
    </main>
  )
}
