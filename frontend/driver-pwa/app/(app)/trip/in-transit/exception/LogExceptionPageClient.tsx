// frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { useTrip } from '@/lib/hooks/useTrip'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { ApiError } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/Button'
import type { ExceptionType } from '@shared/lib/types/exception'
import { DRIVER_EXCEPTION_TYPES } from '@shared/lib/constants/status-meta'

// Labels for the driver-selectable exceptions. Options are DERIVED from the shared
// DRIVER_EXCEPTION_TYPES so the picker can never drift to an invalid / non-driver type
// (e.g. system-detected gps_mismatch or route_deviation). The backend remains the
// authority on what each exception means and whether it is valid.
const EXCEPTION_LABELS: Partial<Record<ExceptionType, string>> = {
  delivery_refused:       'Delivery refused',
  cargo_damage:           'Cargo damage',
  seal_broken_in_transit: 'Seal broken in transit',
  mechanical:             'Vehicle breakdown',
  document_review:        'Document issue',
}

// panic_button has its own dedicated flow (Task 13) — exclude it from this picker.
const EXCEPTION_OPTIONS = DRIVER_EXCEPTION_TYPES
  .filter((value) => value !== 'panic_button')
  .map((value) => ({ value, label: EXCEPTION_LABELS[value] ?? value }))

export default function LogExceptionPageClient() {
  const router = useRouter()
  const { trip, logException } = useTrip()
  const { enqueueException } = useOfflineQueue()
  const [type, setType] = useState<ExceptionType | null>(null)
  const [description, setDescription] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)

  async function handleSubmit() {
    if (!type || !trip) return
    setSubmitting(true)
    setSubmitError(false)
    try {
      await logException(type, { description })
      router.push(ROUTES.inTransit)
    } catch (err) {
      console.error('Failed to log exception', err)
      // A 4xx (e.g. wrong driver, validation) will fail identically on retry — show the
      // error and let the driver fix/retry manually. A network failure or 5xx is
      // retryable, so queue it and let the driver move on; it syncs on reconnect.
      const isRetryable = !(err instanceof ApiError) || err.status >= 500
      if (isRetryable) {
        enqueueException(String(trip.id), { exception_type: type, description })
        router.push(ROUTES.inTransit)
      } else {
        setSubmitError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!trip) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
          <TriangleAlert className="h-10 w-10" strokeWidth={1.5} aria-hidden />
          <h1 className="text-lg font-bold">Unable to verify trip</h1>
          <p className="text-sm opacity-90">
            We could not confirm this exception against your active trip.
            Return to in-transit and try again.
          </p>
        </div>
        <button
          // This state is reachable via cold load, deep link, or refresh —
          // there may be no meaningful back-history, so router.back() could
          // land anywhere (or nowhere). Use an explicit replace so the label's
          // promise ("Return to in-transit") is actually guaranteed.
          onClick={() => router.replace(ROUTES.inTransit)}
          className="text-sm text-secondary underline"
        >
          Return to in-transit
        </button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col p-4">
      <button onClick={() => router.back()} className="mb-4 text-sm text-secondary">← Back</button>
      <h1 className="text-xl font-bold mb-6">Log Exception</h1>

      <div className="flex flex-col gap-3 mb-6">
        {EXCEPTION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setType(opt.value)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
              type === opt.value
                ? 'border-secondary bg-secondary/10 text-secondary'
                : 'border-outline-variant bg-surface-container-lowest text-surface-on'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <textarea
        className="mb-6 w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-sm resize-none"
        rows={4}
        placeholder="Describe what happened (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {submitError && (
        <p className="mb-3 text-sm text-error">Could not submit — check your connection and try again.</p>
      )}
      <Button size="lg" disabled={!type || submitting} onClick={handleSubmit}>
        {submitting ? 'Submitting…' : 'Submit exception'}
      </Button>
    </main>
  )
}
