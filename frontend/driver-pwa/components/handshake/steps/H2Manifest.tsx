// frontend/driver-pwa/components/handshake/steps/H2Manifest.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'
import manifest from '@/lib/mocks/parcel-perfect-manifest.json'

interface H2ManifestProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Manifest({ tripId, draft, onUpdate, onComplete }: H2ManifestProps) {
  const [countInput, setCountInput] = useState(
    draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '',
  )
  const ppCount = manifest.parcel_count
  const driverCount = countInput !== '' ? parseInt(countInput, 10) : null
  const isReady = driverCount !== null && !isNaN(driverCount)
  const hasMismatch = isReady && driverCount !== ppCount

  function handleConfirm() {
    onUpdate({ ppManifestParcelCount: ppCount, driverVisualCount: driverCount })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Loading" stepName="Confirm Manifest" stepIndex={2} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="mb-1 text-xs text-surface-on-variant">Parcel Perfect manifest</p>
          <p className="text-2xl font-bold">{ppCount}</p>
          <p className="text-sm text-surface-on-variant">parcels on this load</p>
          <p className="mt-1 text-xs text-surface-on-variant">{manifest.manifest_reference}</p>
        </div>
        <Input
          label="Your visual count"
          type="number"
          inputMode="numeric"
          placeholder="Count parcels physically"
          value={countInput}
          onChange={(e) => setCountInput(e.target.value)}
        />
        {hasMismatch && (
          <div className="rounded-xl bg-error-container px-4 py-3">
            <p className="text-sm font-medium text-error-on-container">
              Count mismatch: PP says {ppCount}, you counted {driverCount}. This discrepancy will be recorded for review.
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
