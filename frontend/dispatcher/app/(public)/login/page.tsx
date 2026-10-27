'use client'

import { useState, type FormEvent } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { LogoMark } from '@/components/landing/Logo'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/hooks/useAuth'
import { ProfileUnavailableError } from '@/lib/context/AuthContext'
import { ROUTES } from '@/lib/constants/routes'
import { landingHref, readPreferences } from '@/lib/preferences'
import { cn } from '@shared/lib/utils/cn'
import { takeReturnPath } from '@shared/lib/session/return-path'

const NON_RETURNABLE_PREFIXES = [ROUTES.login, ROUTES.dev]

const INVALID_CREDENTIALS = 'Invalid credentials'

const HERO_SRC = '/login/truck-dusk.jpg'
const HERO_CREDIT = 'Photo: Vitalii Onyshchuk / Unsplash'
const COPYRIGHT_YEAR = 2026

export default function LoginPage() {
  const router = useRouter()
  const { signIn, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  const isCredentialError = error === INVALID_CREDENTIALS

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      setError(INVALID_CREDENTIALS)
      triggerShake()
      return
    }

    try {
      await signIn({ email, password })
      const returnTo = takeReturnPath(window.localStorage, NON_RETURNABLE_PREFIXES)
      router.push(returnTo ?? landingHref(readPreferences().landingPage))
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
    <main className="grid min-h-screen bg-surf lg:grid-cols-[minmax(0,1fr)_500px] xl:grid-cols-[minmax(0,1fr)_640px]">
      <section aria-label="FreightProof" className="relative isolate flex h-56 flex-col justify-between overflow-hidden p-6 text-white sm:h-72 lg:h-auto lg:p-10">
        <Image src={HERO_SRC} alt="" fill priority sizes="(min-width: 1024px) 55vw, 100vw"
          className="-z-10 object-cover object-[50%_62%] lg:object-[22%_72%]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/60 via-primary/10 to-primary/80" />
        <div>
          <span className="inline-flex items-center gap-2.5">
            <span className="flex size-[52px] shrink-0 items-center justify-center rounded-lg bg-surf">
              <LogoMark size={36} />
            </span>
            <span className="text-[28px] font-[800] leading-none tracking-[-0.035em] text-white">FreightProof</span>
          </span>
          <p className="mt-2 text-[11px] font-[700] uppercase tracking-[0.18em] text-white/75">Dispatcher portal</p>
        </div>
        <div className="hidden lg:block">
          <p className="text-[34px] font-[800] leading-[1.05] tracking-[-0.035em] xl:text-[44px]">
            Cargo moves.<br /><span className="pr-[0.12em] italic">Proof</span> stays.
          </p>
          <p className="mt-10 text-[11px] text-white/55">{HERO_CREDIT}</p>
        </div>
      </section>

      <section className="flex flex-col px-6 py-10 sm:px-10 lg:py-12">
        <div className="flex flex-1 items-start justify-center lg:items-center">
          <div className={cn('w-full max-w-[400px]', shaking && 'animate-shake')}>
            <h1 className="text-[28px] font-[800] leading-tight tracking-[-0.02em] text-on-surf">Sign in</h1>
            <p className="mt-1.5 text-sm text-on-surf-v">Use your dispatcher account to open the portal.</p>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
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
              <Button type="submit" variant="primary" loading={isLoading} full className="mt-2">
                Sign in
              </Button>
            </form>
            <p className="mt-6 text-xs leading-relaxed text-on-surf-v">
              No account, or locked out? Your operator&apos;s admin dispatcher manages access.
            </p>
          </div>
        </div>
        <p className="mt-10 text-[11px] text-on-surf-v">© {COPYRIGHT_YEAR} FreightProof SA · UCT INF4027W Honours</p>
      </section>
    </main>
  )
}
