// frontend/driver-pwa/components/handshake/steps/H5Reconciliation.tsx
'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

// Renders a green check / red cross for a boolean reconciliation row.
function StatusMark({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} aria-label="Done" />
  ) : (
    <XCircle className="h-5 w-5 text-error" strokeWidth={2} aria-label="Missing" />
  )
}

interface H5ReconciliationProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5Reconciliation({ tripId, draft, onUpdate, onComplete }: H5ReconciliationProps) {
  function handleConfirm() {
    onUpdate({ reconciliationNote: 'Driver confirmed delivery reconciliation at destination.' })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshake={5} step={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Confirm that the unloading is reconciled with the warehouse. Any discrepancies have been logged.
        </p>
        {/* POD / reconciliation-note fields are deliberately omitted from this summary —
            BQ2 (physical POD vs on-device signature) is unresolved, so this is a 3-of-6-field
            summary by design, not an oversight. */}
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-3">
          <div className="flex justify-between">
            <span className="text-sm text-surface-on-variant">Parcels counted at destination</span>
            <span className="text-sm font-bold">{draft.driverVisualCount ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-surface-on-variant">Seal broken &amp; photographed</span>
            <StatusMark ok={draft.sealBrokenPhotoDataUrl !== null} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-surface-on-variant">Waybill handed over</span>
            <StatusMark ok={draft.waybillHandedOver === true} />
          </div>
        </div>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Confirm reconciliation" onConfirm={handleConfirm} />
      </div>
    </main>
  )
}
