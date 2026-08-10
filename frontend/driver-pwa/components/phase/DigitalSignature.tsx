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
import { hasRecipientIdentity } from '@/lib/utils/sa-id'
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
  /**
   * The receiver's identity, owned by the step (which owns the draft) and passed down
   * purely as what gets drawn into the attestation. Null until they have been entered —
   * the swipe stays disabled until both are present, because an attestation that cannot
   * name its signer is the weakest possible proof of delivery.
   */
  recipientName: string | null
  recipientIdNumber: string | null
  onSign: (result: DigitalSignatureResult) => void | Promise<void>
}

export function DigitalSignature({
  tripId, dataUrl, recipientName, recipientIdNumber, onSign,
}: DigitalSignatureProps) {
  const { capturePosition } = useLocationTrail()
  const { notify } = useToast()
  const [position, setPosition] = useState<DriverPosition | null>(null)
  const [hasFix, setHasFix] = useState(false)

  const hasIdentity = hasRecipientIdentity(recipientName, recipientIdNumber)

  const handleSwipe = useCallback(async () => {
    // Redundant backstop, deliberately kept. SwipeToConfirm's own `disabled` handling is
    // the REAL gate — it blocks the drag, the keyboard path and the tap-to-confirm path
    // alike, which is why the tests below cannot distinguish this line's presence from
    // its absence. It stays because the cost is one comparison and the failure it guards
    // against is an attestation that cannot name its signer: if anyone later drops the
    // `disabled` prop below, or SwipeToConfirm's locking changes, this is what stops a
    // POD being signed by nobody. Do not "simplify" it away on the grounds that it is
    // untested — it is untestable from outside, not unnecessary.
    if (!hasRecipientIdentity(recipientName, recipientIdNumber)) return

    // The fix is taken at the swipe, not on mount: a position captured when the screen
    // opened could be minutes and a warehouse away from where the receiver actually
    // signed, and the attestation claims the latter.
    const fix = await capturePosition()
    setPosition(fix)
    setHasFix(fix !== null)

    const signedAt = new Date().toISOString()
    const rendered = renderAttestation({
      signedAt,
      position: fix,
      tripId,
      // Non-null by the guard above; trimmed so a stray keyboard space is not baked into
      // the artifact as part of the receiver's name.
      recipientName: (recipientName ?? '').trim(),
      recipientIdNumber: (recipientIdNumber ?? '').trim(),
    })

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
  }, [capturePosition, notify, onSign, tripId, recipientName, recipientIdNumber])

  if (dataUrl !== null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-base font-medium">Receiver signature</p>
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
        <p className="text-lg font-medium text-surface-on">By signing, the receiver confirms:</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-base text-surface-on-variant">
          <li>• The delivery was received</li>
          <li>• Their name and ID number are recorded</li>
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
      <SwipeToConfirm
        label="Swipe to digitally sign"
        onConfirm={handleSwipe}
        disabled={!hasIdentity}
      />
    </div>
  )
}
