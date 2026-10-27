'use client'

// Route-level error boundary (Next.js App Router convention file). Catches render and
// runtime errors from any page under the root layout, so a crash shows recovery UI
// instead of a blank white screen mid-phase. This is purely client-side React —
// exactly what output: 'export' supports, since a static export has no server error page.

import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('Route error boundary caught', error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
        <TriangleAlert className="h-10 w-10" strokeWidth={1.5} aria-hidden />
        <h1 className="text-lg font-bold">Something went wrong</h1>
        <p className="text-sm opacity-90">
          The app hit a problem and couldn&rsquo;t finish what it was doing.
          Any photos or details you&rsquo;ve captured are saved on this device. Nothing is lost.
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Button size="lg" onClick={reset}>
          Try Again
        </Button>
        <Button asChild variant="secondary" size="lg">
          <a href={ROUTES.home}>Go to Home</a>
        </Button>
      </div>
    </main>
  )
}
