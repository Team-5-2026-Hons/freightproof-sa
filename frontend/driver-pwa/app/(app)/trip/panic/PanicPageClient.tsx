// frontend/driver-pwa/app/(app)/trip/panic/PanicPageClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocation } from '@/lib/hooks/useLocation'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { HoldButton } from '@/components/handshake/HoldButton'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'

export default function PanicPageClient() {
  const router = useRouter()
  const { trip, isLoading, logException } = useTrip()
  const { capture } = useLocation()
  const { enqueueException } = useOfflineQueue()
  const [sending, setSending] = useState(false)

  async function handlePanic() {
    setSending(true)
    // This is an emergency action gated behind a 3s hold, so the driver has
    // already committed several seconds to triggering it. GPS capture here
    // resolves quickly (~300ms dev fallback; real native lock typically
    // well under 2s) — awaiting it before logException means the alert
    // record actually carries coordinates instead of racing to send one
    // without location data. We accept the brief additional wait in
    // exchange for a complete, defensible payload; `sending` drives a
    // lightweight loading state below so the UI doesn't appear frozen.
    const result = await capture()
    const description = 'Driver activated panic button.'
    // Tracks whether the alert actually reached the backend vs. was only queued
    // on-device — PanicSubmittedPageClient needs this to avoid claiming "your
    // dispatcher has been notified" when nothing has actually sent yet.
    let queued = false
    try {
      await logException('panic_button', {
        description,
        triggeredAt: new Date().toISOString(),
        gpsLat: result?.latitude ?? null,
        gpsLng: result?.longitude ?? null,
      })
    } catch (err) {
      // Emergency action — don't strand the driver on this screen if the network call
      // fails. Queue it for retry on reconnect (same mechanism handshakes use) instead
      // of just logging and losing it, since this is the one alert that must land.
      console.error('Failed to send panic alert to backend — queued for retry', err)
      if (trip) enqueueException(String(trip.id), { exception_type: 'panic_button', description })
      queued = true
    }
    router.replace(ROUTES.panicSubmittedUrl(queued))
  }

  if (isLoading) return null

  if (!trip) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-error p-6">
        <div className="flex flex-col items-center text-center text-error-on">
          <TriangleAlert className="mb-4 h-14 w-14" strokeWidth={1.5} aria-hidden />
          <h1 className="mb-2 text-2xl font-bold">Unable to verify trip</h1>
          <p className="text-sm opacity-90">
            We could not confirm this panic alert against your active trip.
            Contact dispatch directly for emergency assistance.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          // This state is reachable via cold load, deep link, or refresh —
          // there may be no meaningful back-history, so router.back() could
          // land anywhere (or nowhere). Use an explicit replace so the label's
          // promise ("Return to in-transit") is actually guaranteed.
          onClick={() => router.replace(ROUTES.inTransit)}
          // Ghost's default text-secondary/hover:bg-secondary/10 is unreadable on this
          // screen's bg-error backdrop — override to the same dim error-on tone the raw
          // button used, keeping the visual intent while gaining the shared Button.
          className="text-error-on/70 hover:bg-error-on/10"
        >
          Return to in-transit
        </Button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-error px-6 pt-6 pb-safe">
      <div className="flex flex-col items-center text-center text-error-on">
        <ShieldAlert className="mb-4 h-14 w-14" strokeWidth={1.5} aria-hidden />
        <h1 className="mb-2 text-2xl font-bold">Panic Alert</h1>
        <p className="text-sm opacity-90">
          Hold the button below to send an emergency alert to your dispatcher.
          Your GPS location will be included.
        </p>
        {sending && (
          <p className="mt-2 text-xs opacity-75" role="status">
            Capturing location and sending alert…
          </p>
        )}
      </div>
      <HoldButton
        label="Send panic"
        durationMs={3000}
        onConfirm={handlePanic}
        variant="danger"
      />
      <Button
        type="button"
        variant="ghost"
        onClick={() => router.back()}
        className="text-error-on/70 hover:bg-error-on/10"
      >
        Cancel
      </Button>
    </main>
  )
}
