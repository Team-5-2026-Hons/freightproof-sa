// frontend/driver-pwa/components/handshake/steps/H2Linehaul.tsx
'use client'

import { useEffect, useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import { Spinner } from '@/components/ui/Spinner'
import { fetchLinehaul } from '@/lib/api/manifest'
import type { Linehaul } from '@shared/lib/types/manifest'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2LinehaulProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

// Driver-facing Linehaul document — deliberately shows only vehicle/driver/consolidated
// unit count, never per-parcel data (theft-risk rule). Replaces the old mock-only
// "Confirm Manifest" step; the backend strips per-parcel detail for driver tokens.
export function H2Linehaul({ tripId, draft, onUpdate, onComplete }: H2LinehaulProps) {
  const [linehaul, setLinehaul] = useState<Linehaul | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [countInput, setCountInput] = useState(
    draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '',
  )

  useEffect(() => {
    let cancelled = false
    fetchLinehaul(tripId)
      .then((result) => { if (!cancelled) setLinehaul(result) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId])

  const unitCount = linehaul?.consolidated_unit_count ?? null
  const driverCount = countInput !== '' ? parseInt(countInput, 10) : null
  const isReady = driverCount !== null && !isNaN(driverCount) && unitCount !== null
  const hasMismatch = isReady && driverCount !== unitCount

  function handleConfirm() {
    if (unitCount === null) return
    onUpdate({ ppManifestParcelCount: unitCount, driverVisualCount: driverCount })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Confirm Linehaul" stepIndex={2} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {loading ? (
          <Spinner />
        ) : error || linehaul === null ? (
          <p className="text-sm text-error">Could not load the Linehaul document — check connection and retry.</p>
        ) : (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
            <p className="mb-1 text-xs text-surface-on-variant">Vehicle</p>
            <p className="text-lg font-bold">{linehaul.vehicle_registration}</p>
            <p className="mb-1 mt-3 text-xs text-surface-on-variant">Driver</p>
            <p className="text-lg font-bold">{linehaul.driver_full_name}</p>
            <p className="mb-1 mt-3 text-xs text-surface-on-variant">Consolidated units</p>
            <p className="text-2xl font-bold">{linehaul.consolidated_unit_count}</p>
          </div>
        )}
        <Input
          label="Your visual count"
          type="number"
          inputMode="numeric"
          placeholder="Count units physically"
          value={countInput}
          onChange={(e) => setCountInput(e.target.value)}
        />
        {hasMismatch && (
          <div className="rounded-xl bg-error-container px-4 py-3">
            <p className="text-sm font-medium text-error-on-container">
              Count mismatch: Linehaul says {unitCount}, you counted {driverCount}. This discrepancy will be recorded for review.
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Confirm count" onConfirm={handleConfirm} disabled={!isReady} />
      </div>
    </main>
  )
}
