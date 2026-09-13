// frontend/receiver/app/h/[token]/HandoverPageClient.tsx
//
// The receiver's whole experience (FP-155). Opened from a QR by someone with no account,
// no app and no prior relationship with this system, usually one-handed, on a warehouse
// floor. Four states and nothing else: loading, invalid, ready, done.
//
// The page is deliberately incurious about WHY a token is invalid. The API returns one
// generic 404 for expired, unknown, retired, already-redeemed and wrong-browser alike, so
// that it cannot be used as an oracle to probe for live tokens — and this client must not
// undo that by inferring a reason from a status code and explaining it helpfully.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Swipe } from '@/components/Swipe'
import { confirmHandover, fetchScan, type HandoverScan } from '@/lib/api'
import { renderAttestation } from '@shared/lib/utils/render-attestation'
import { hasRecipientIdentity, looksLikeSaIdNumber } from '@shared/lib/utils/sa-id'
import type { PositionFix } from '@shared/lib/types/position'

// Ceiling on the browser geolocation prompt. A receiver who ignores the permission dialog
// must not leave the delivery unconfirmable — the fix is valuable evidence, not a
// precondition, so the swipe proceeds without one rather than hanging on it.
const GEO_TIMEOUT_MS = 8_000

type Status = 'loading' | 'invalid' | 'ready' | 'signing' | 'done'

/** Resolves to a fix, or to null on refusal, failure or timeout. Never rejects. */
function capturePosition(): Promise<PositionFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      }),
      // A denied permission and a failed fix are the same outcome here: no position. The
      // absence is recorded server-side as null, and is itself part of the record.
      () => resolve(null),
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

export function HandoverPageClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('loading')
  const [scan, setScan] = useState<HandoverScan | null>(null)
  const [name, setName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchScan(token)
      .then((res) => { if (!cancelled) { setScan(res); setStatus('ready') } })
      .catch((err: unknown) => {
        if (cancelled) return
        // Every failure lands here identically, including a network error. Telling a
        // receiver with no signal that their link is invalid is a small lie; telling a
        // prober which of their guesses was live is a security hole. The lie is cheaper.
        console.warn('[handover] scan lookup failed:', err)
        setStatus('invalid')
      })
    return () => { cancelled = true }
  }, [token])

  const handleSign = useCallback(async () => {
    if (scan === null || !hasRecipientIdentity(name, idNumber)) return
    setStatus('signing')
    setMessage('')

    // Fix taken at the swipe, never on mount: a position captured when the page opened
    // could be minutes and a building away from where the receiver actually signed, and
    // the attestation claims the latter. Same reasoning as the driver-side original.
    const fix = await capturePosition()
    const signedAt = new Date().toISOString()

    const dataUrl = renderAttestation({
      signedAt,
      position: fix,
      // The trip REFERENCE, not its uuid — it is what the receiver can read off the
      // paperwork in their hand, and this app is never given the internal id.
      tripId: scan.trip_reference,
      recipientName: name.trim(),
      recipientIdNumber: idNumber.trim(),
    })

    if (dataUrl === null) {
      // No 2D context, so there is no artifact. Failing here keeps the receiver on the
      // page; confirming with nothing attached would leave a POD with an empty signature
      // slot that nobody notices until a dispute.
      setMessage('The signature could not be generated on this device. Please try again.')
      setStatus('ready')
      return
    }

    try {
      await confirmHandover(token, {
        receiver_name: name.trim(),
        receiver_id_number: idNumber.trim(),
        signature_png_base64: dataUrl,
        receiver_lat: fix?.lat ?? null,
        receiver_lng: fix?.lng ?? null,
        receiver_accuracy_m: fix?.accuracyM ?? null,
      })
      setStatus('done')
    } catch (err: unknown) {
      // A failed confirm may have burned the token — redemption is the first thing the
      // server does once the binding check passes — so the honest state is "this link is
      // finished" rather than an encouraging retry that would 404 and confuse them more.
      console.warn('[handover] confirm failed:', err)
      setStatus('invalid')
    }
  }, [scan, name, idNumber, token])

  if (status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-base text-neutral-500">Loading delivery…</p>
      </main>
    )
  }

  if (status === 'invalid') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium text-neutral-900">This link is no longer valid</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          Ask the driver to show you a fresh code. Codes refresh regularly, each one can
          only be used once, and a code has to be opened on the phone that scanned it.
        </p>
      </main>
    )
  }

  if (status === 'done') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
          <span className="text-3xl" aria-hidden="true">✓</span>
        </div>
        <h1 className="text-xl font-medium text-neutral-900">Delivery confirmed</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          Thank you. You can close this page — nothing else is needed from you.
        </p>
      </main>
    )
  }

  const showIdShapeHint = idNumber.trim().length > 0 && !looksLikeSaIdNumber(idNumber)
  const isSigning = status === 'signing'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium text-neutral-900">Confirm this delivery</h1>
        <p className="text-sm text-neutral-600">
          {scan?.destination_name} · {scan?.trip_reference}
        </p>
      </header>

      {scan !== null && scan.waybill_references.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-medium text-neutral-900">Waybills</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-neutral-600">
            {scan.waybill_references.map((ref) => <li key={ref}>{ref}</li>)}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-900">Your full name</span>
          <input
            className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
            value={name}
            autoComplete="off"
            disabled={isSigning}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-900">Your ID number</span>
          <input
            className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
            value={idNumber}
            inputMode="numeric"
            autoComplete="off"
            disabled={isSigning}
            onChange={(e) => setIdNumber(e.target.value)}
          />
          {/* Advisory, never a gate. A receiver may legitimately present a passport or a
              company registration number, and a mistyped digit is itself evidence of what
              was produced at the door — carried from the driver-side step this replaces,
              where the reasoning was identical and remains correct on a different device. */}
          {showIdShapeHint && (
            <span className="text-xs text-neutral-500">
              This is not a 13 digit SA ID number. It will still be recorded as entered.
            </span>
          )}
        </label>
      </div>

      <div className="rounded-xl border border-neutral-200 p-4">
        <p className="text-base font-medium text-neutral-900">By signing, you confirm:</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
          <li>• The delivery was received</li>
          <li>• Your name and ID number are recorded</li>
          <li>• The time of signing is recorded</li>
          <li>• Your device&apos;s location is recorded, if you allow it</li>
        </ul>
      </div>

      {message !== '' && <p className="text-sm text-red-600">{message}</p>}

      <div className="mt-auto pb-6">
        <Swipe
          label={isSigning ? 'Confirming…' : 'Swipe to confirm delivery'}
          disabled={!hasRecipientIdentity(name, idNumber) || isSigning}
          onConfirm={handleSign}
        />
      </div>
    </main>
  )
}
