// frontend/driver-pwa/components/handshake/steps/H2Linehaul.tsx
'use client'

import { useEffect, useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
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
  // Bumped by the retry button to re-run the effect below — the fetch otherwise only
  // ever fires once per mount, leaving the driver stuck on a dead-end error with no
  // way to recover short of navigating away and back.
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchLinehaul(tripId)
      .then((result) => { if (!cancelled) setLinehaul(result) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId, retryCount])

  // Reset loading/error state from the retry button's click handler, not inside the
  // effect body — synchronous setState at the top of an effect triggers a cascading
  // re-render (react-hooks/set-state-in-effect). The initial loading=true/error=false
  // values already cover the first mount; only a retry needs an explicit reset.
  function handleRetry() {
    setError(false)
    setLoading(true)
    setRetryCount((count) => count + 1)
  }

  const unitCount = linehaul?.consolidated_unit_count ?? null
  const driverCount = countInput !== '' ? parseInt(countInput, 10) : null
  // >= 0, not > 0: an empty load (0) is a legitimate, flaggable observation — the driver
  // reporting "nothing was loaded" is exactly the kind of evidence this app records. A
  // negative count is physically meaningless, so it can never be ready to submit.
  const hasDriverCount = driverCount !== null && !isNaN(driverCount) && driverCount >= 0
  // 404 (fetchLinehaul resolved null) means no Linehaul document exists for this trip —
  // a normal state (any trip without a Parcel Perfect reference), not a failure. The
  // driver can still proceed on a valid visual count alone; a real fetch error cannot.
  const noLinehaulDocument = !loading && !error && linehaul === null
  const isReady = hasDriverCount && (unitCount !== null || noLinehaulDocument)
  // Only meaningful once a real Linehaul unit count exists to compare against.
  const hasMismatch = hasDriverCount && unitCount !== null && driverCount !== unitCount

  function handleConfirm() {
    if (!hasDriverCount) return
    onUpdate({ ppManifestParcelCount: unitCount, driverVisualCount: driverCount })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshake={2} step={2} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-error">Could not load the Linehaul document — check connection and retry.</p>
            <Button variant="secondary" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        ) : linehaul === null ? (
          <div className="rounded-xl bg-surface-container-low px-4 py-3">
            <p className="text-sm text-surface-on-variant">
              No Linehaul document is available for this trip. Record your own count — it will be used as the reference.
            </p>
          </div>
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
          // min backs up the >= 0 readiness check at the browser/keyboard level (numeric
          // keypads suppress the minus key when min is non-negative); the JS check above
          // remains the real gate since min alone doesn't stop typed/pasted negatives.
          min={0}
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
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Confirm count" onConfirm={handleConfirm} disabled={!isReady} />
      </div>
    </main>
  )
}
