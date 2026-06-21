'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { HoldButton } from '@/components/handshake/HoldButton'
import { ROUTES } from '@/lib/constants/routes'

export default function PanicPage() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const { logException } = useTrip()

  function handlePanic() {
    logException('panic_button', {
      description: 'Driver activated panic button.',
      triggeredAt: new Date().toISOString(),
    })
    router.replace(ROUTES.panicSubmitted(tripId))
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-error p-6">
      <div className="flex flex-col items-center text-center text-error-on">
        <ShieldAlert className="mb-4 h-14 w-14" strokeWidth={1.5} aria-hidden />
        <h1 className="mb-2 text-2xl font-bold">Panic Alert</h1>
        <p className="text-sm opacity-90">
          Hold the button below to send an emergency alert to your dispatcher.
          Your GPS location will be included.
        </p>
      </div>
      <HoldButton
        label="Send panic"
        durationMs={3000}
        onConfirm={handlePanic}
        variant="danger"
      />
      <button
        onClick={() => router.back()}
        className="text-sm text-error-on/70 underline"
      >
        Cancel — return to in-transit
      </button>
    </main>
  )
}
