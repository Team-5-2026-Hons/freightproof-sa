// frontend/driver-pwa/components/phase/DigitalSignature.tsx
//
// The receiver's digital signature: a swipe that attests to delivery, stamped with the
// instant and the phone's position at that instant.
//
// Replaces the drawn-signature pad on the POD step. The swipe is the receiver's act —
// it is deliberate, it cannot fire from an accidental tap, and it is taken on the
// driver's device in front of them, which is what the attestation claims. What it does
// not carry is a handwritten mark, so it is a weaker artifact than the pad it replaces;
// that trade was made deliberately (see the task that introduced this file).
'use client'

import { useCallback, useState } from 'react'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { useLocationTrail } from '@/lib/hooks/useLocationTrail'
import { useToast } from '@/lib/hooks/useToast'
import { renderAttestation, formatPosition } from '@/lib/utils/render-attestation'
import type { DriverPosition } from '@/lib/types/location'

export interface DigitalSignatureResult {
  /** PNG data URL of the rendered attestation — the artifact that gets uploaded. */
  dataUrl: string
  /** ISO 8601 instant of the swipe. Also stamped into the image. */
  signedAt: string
  /** Fix at the moment of signing, or null when the phone could not produce one. */
  position: DriverPosition | null
}

interface DigitalSignatureProps {
  tripId: string
  /** A previously-rendered attestation, shown instead of the swipe once signed. */
  dataUrl: string | null
  onSign: (result: DigitalSignatureResult) => void | Promise<void>
}

export function DigitalSignature({ tripId, dataUrl, onSign }: DigitalSignatureProps) {
  const { capturePosition } = useLocationTrail()
  const { notify } = useToast()
  const [position, setPosition] = useState<DriverPosition | null>(null)
  const [hasFix, setHasFix] = useState(false)

  const handleSwipe = useCallback(async () => {
    // The fix is taken at the swipe, not on mount: a position captured when the screen
    // opened could be minutes and a warehouse away from where the receiver actually
    // signed, and the attestation claims the latter.
    const fix = await capturePosition()
    setPosition(fix)
    setHasFix(fix !== null)

    const signedAt = new Date().toISOString()
    const rendered = renderAttestation({ signedAt, position: fix, tripId })

    // A null render means no 2D context, so there is no artifact to upload. Failing here
    // keeps the receiver on the step; signing them through with nothing attached would
    // leave a POD with an empty signature slot that nobody notices until a dispute.
    if (rendered === null) {
      notify({
        kind: 'error',
        title: 'Could not sign',
        body: 'The signature could not be generated on this device. Try again.',
      })
      return
    }

    await onSign({ dataUrl: rendered, signedAt, position: fix })
  }, [capturePosition, notify, onSign, tripId])

  if (dataUrl !== null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Receiver signature</p>
        <div className="relative w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-low">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt="Digital proof of delivery" className="w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
        <p className="text-sm font-medium text-surface-on">By signing, the receiver confirms:</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-surface-on-variant">
          <li>• The delivery was received</li>
          <li>• The time of signing is recorded</li>
          <li>• The location of signing is recorded</li>
        </ul>
        {/* Shown only after a swipe has actually resolved a fix, so it reports what was
            captured rather than promising what might be. */}
        {hasFix && (
          <p className="mt-3 font-mono text-xs text-surface-on-variant">
            {formatPosition(position)}
          </p>
        )}
      </div>
      <SwipeToConfirm label="Swipe to digitally sign" onConfirm={handleSwipe} />
    </div>
  )
}
