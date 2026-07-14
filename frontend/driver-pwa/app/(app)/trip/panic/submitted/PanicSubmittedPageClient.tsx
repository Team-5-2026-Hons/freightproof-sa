// frontend/driver-pwa/app/(app)/trip/panic/submitted/PanicSubmittedPageClient.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Clock } from 'lucide-react'
import { ROUTES, PANIC_QUEUED_PARAM } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'

export default function PanicSubmittedPageClient() {
  const router = useRouter()
  const params = useSearchParams()
  // Set by PanicPageClient (via ROUTES.panicSubmittedUrl) only when the alert couldn't
  // reach the backend and was queued on-device instead — anything else means it sent.
  // Never claim the dispatcher was notified when that hasn't actually happened yet.
  const queued = params.get(PANIC_QUEUED_PARAM) === '1'

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <div className={`flex h-20 w-20 items-center justify-center rounded-full ${queued ? 'bg-tertiary/10' : 'bg-success/10'}`}>
        {queued ? (
          <Clock className="h-10 w-10 text-tertiary" strokeWidth={2} aria-hidden />
        ) : (
          <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={2} aria-hidden />
        )}
      </div>
      <h1 className="text-xl font-bold">{queued ? 'Alert saved' : 'Alert sent'}</h1>
      <p className="text-sm text-surface-on-variant max-w-xs">
        {queued ? (
          <>
            No signal right now — this alert is stored on this device and will send
            automatically the moment you&apos;re back in range. This event has already
            been recorded and timestamped.
          </>
        ) : (
          <>
            Your dispatcher has been notified. Stay calm and wait for contact.
            This event has been recorded and timestamped.
          </>
        )}
      </p>
      <Button size="lg" onClick={() => router.replace(ROUTES.inTransit)}>
        Return to in-transit
      </Button>
    </main>
  )
}
