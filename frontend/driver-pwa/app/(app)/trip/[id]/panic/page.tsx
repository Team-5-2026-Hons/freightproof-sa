'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useLocation } from '@/lib/hooks/useLocation'
import { HoldButton } from '@/components/handshake/HoldButton'
import { ROUTES } from '@/lib/constants/routes'

export default function PanicPage() {
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const { trip, logException } = useTrip()
  const { capture } = useLocation()
  const [sending, setSending] = useState(false)

  // Guard against logging the alert against the wrong trip: `trip` comes from
  // the driver's session (TripContext), not this page's URL param. If the
  // session trip is missing or doesn't match the URL, we cannot safely
  // attribute a panic alert to tripId — render an unavailable state instead
  // of the hold-to-confirm UI (not just disable it; the action must be
  // unreachable, not merely discouraged).
  const tripVerified = trip !== null && String(trip.id) === tripId

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
    logException('panic_button', {
      description: 'Driver activated panic button.',
      triggeredAt: new Date().toISOString(),
      gpsLat: result?.latitude ?? null,
      gpsLng: result?.longitude ?? null,
    })
    router.replace(ROUTES.panicSubmitted(tripId))
  }

  if (!tripVerified) {
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
        <button
          onClick={() => router.back()}
          className="text-sm text-error-on/70 underline"
        >
          Return to in-transit
        </button>
      </main>
    )
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
      <button
        onClick={() => router.back()}
        className="text-sm text-error-on/70 underline"
      >
        Cancel — return to in-transit
      </button>
    </main>
  )
}
