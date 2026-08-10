'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/hooks/useAuth'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'

export default function LoginPage() {
  const router = useRouter()
  const { signIn, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [shaking, setShaking] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      setError(true)
      triggerShake()
      return
    }

    try {
      await signIn({ email, password })
      router.push(ROUTES.home)
    } catch {
      setError(true)
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
            onChange={e => { setEmail(e.target.value); setError(false) }}
            error={error ? 'Invalid credentials' : undefined}
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false) }}
            error={error ? 'Invalid credentials' : undefined}
            autoComplete="current-password"
          />
          <Button type="submit" loading={isLoading} className="mt-2">
            Sign In
          </Button>
        </form>
      </Card>
    </main>
  )
}
