// frontend/driver-pwa/app/(app)/trip/[id]/in-transit/exception/LogExceptionPageClient.tsx
'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTrip } from '@/lib/hooks/useTrip'
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
  const { id: tripId } = useParams<{ id: string }>()
  const router = useRouter()
  const { logException } = useTrip()
  const [type, setType] = useState<ExceptionType | null>(null)
  const [description, setDescription] = useState('')

  function handleSubmit() {
    if (!type) return
    logException(type, { description })
    router.push(ROUTES.inTransit(tripId))
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

      <Button size="lg" disabled={!type} onClick={handleSubmit}>
        Submit exception
      </Button>
    </main>
  )
}
