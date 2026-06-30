// frontend/driver-pwa/app/(app)/trip/panic/submitted/PanicSubmittedPageClient.tsx
'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'

export default function PanicSubmittedPageClient() {
  const router = useRouter()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={2} aria-hidden />
      </div>
      <h1 className="text-xl font-bold">Alert sent</h1>
      <p className="text-sm text-surface-on-variant max-w-xs">
        Your dispatcher has been notified. Stay calm and wait for contact.
        This event has been recorded and timestamped.
      </p>
      <Button size="lg" onClick={() => router.replace(ROUTES.inTransit)}>
        Return to in-transit
      </Button>
    </main>
  )
}
