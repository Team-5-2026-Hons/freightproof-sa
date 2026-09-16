// The receiver's whole experience. Opened from a QR by someone with no account, no app
// and no prior relationship with this system, usually one-handed on a warehouse floor.
//
// Deliberately incurious about WHY a token is invalid: the API returns one generic 404
// for expired/unknown/retired/redeemed/wrong-browser alike so it can't be used as an
// oracle to probe for live tokens, and this client must not undo that by explaining.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Swipe } from '@/components/Swipe'
import { ConsentGate } from '@/components/ConsentGate'
import { SelfieCapture } from '@/components/SelfieCapture'
import {
  confirmHandover,
  fetchScan,
  recordConsent,
  resolveVerification,
  startVerification,
  type HandoverScan,
} from '@/lib/api'
import { consentPayloadText } from '@/lib/consent'
import { renderAttestation } from '@shared/lib/utils/render-attestation'
import { hasRecipientIdentity, looksLikeSaIdNumber } from '@shared/lib/utils/sa-id'
import type { PositionFix } from '@shared/lib/types/position'

// Ceiling on the browser geolocation prompt. A receiver who ignores the permission dialog
// must not leave the delivery unconfirmable, so the swipe proceeds without a fix rather
// than hanging on one.
const GEO_TIMEOUT_MS = 8_000

// The typed identity must survive a full navigation to the vendor's domain and back —
// React state doesn't (the page is destroyed and rebuilt), and without it
// resolveVerification would cross-check against two empty strings, silently disabling the
// substitution defence. sessionStorage, not localStorage: it dies with the tab, the right
// lifetime for a stranger's ID number on a device we don't own.
const IDENTITY_STASH_KEY = 'fp_handover_identity'

interface StashedIdentity {
  name: string
  idNumber: string
  /** The mock vendor page carries no capability token, so the return path travels with the identity. */
  token: string
}

function stashIdentity(identity: StashedIdentity): void {
  try {
    sessionStorage.setItem(IDENTITY_STASH_KEY, JSON.stringify(identity))
  } catch {
    // Storage unavailable — the cross-check degrades to "nothing to compare".
  }
}

function readStashedIdentity(): StashedIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_STASH_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Partial<StashedIdentity>).name === 'string' &&
      typeof (parsed as Partial<StashedIdentity>).idNumber === 'string'
    ) {
      return parsed as StashedIdentity
    }
    return null
  } catch {
    return null
  }
}

function clearStashedIdentity(): void {
  try {
    sessionStorage.removeItem(IDENTITY_STASH_KEY)
  } catch {
    // Nothing to clear, or storage is unavailable — either way nothing to do.
  }
}

// 'consent' / 'verifying' / 'selfie' sit between 'loading' and 'ready'. None may become a
// dead end — every path out of them lands back on 'ready'.
type Status = 'loading' | 'invalid' | 'consent' | 'verifying' | 'selfie' | 'ready' | 'signing' | 'done'

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
      // A denied permission and a failed fix are the same outcome here: no position.
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
  // Busy flag for ConsentGate's `busy` prop: the consent-record call stays on this screen
  // in flight rather than swapping pages.
  const [consentBusy, setConsentBusy] = useState(false)
  // Tier-3 artifact — held here between capture and confirm; no upload endpoint yet.
  const [selfiePhoto, setSelfiePhoto] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadScan(): Promise<void> {
      const res = await fetchScan(token)
      if (cancelled) return
      setScan(res)

      if (res.verification === null) {
        setStatus('consent')
        return
      }

      if (res.verification.status === 'pending') {
        // Returning from the vendor's redirect — a fresh page load, so recovered from
        // sessionStorage rather than React state, which is gone.
        const stashed = readStashedIdentity()
        if (stashed !== null && !cancelled) {
          setName(stashed.name)
          setIdNumber(stashed.idNumber)
        }
        try {
          await resolveVerification(token, stashed?.name ?? name, stashed?.idNumber ?? idNumber)
        } catch (err: unknown) {
          // A failed resolve must never strand the receiver mid-check.
          console.warn('[handover] verification resolve failed:', err)
        }
        // Cleared regardless of outcome — a retained ID number on someone else's phone is
        // a liability that has already served its only purpose.
        clearStashedIdentity()
        if (!cancelled) setStatus('ready')
        return
      }

      setStatus('ready')
    }

    loadScan().catch((err: unknown) => {
      if (cancelled) return
      // Every failure, including a network error, lands here identically: telling a
      // prober which guess was live is a security hole, so the generic message stays.
      console.warn('[handover] scan lookup failed:', err)
      setStatus('invalid')
    })
    return () => { cancelled = true }
    // Deliberately depends only on `token` — name/idNumber are read only as the
    // resume-from-vendor fallback and are still empty at mount. Listing them would re-run
    // this effect on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleSign = useCallback(async () => {
    if (scan === null || !hasRecipientIdentity(name, idNumber)) return
    setStatus('signing')
    setMessage('')

    // Fix taken at the swipe, never on mount: a position captured on page-open could be
    // minutes and a building away from where the receiver actually signed.
    const fix = await capturePosition()
    const signedAt = new Date().toISOString()

    const dataUrl = renderAttestation({
      signedAt,
      position: fix,
      // The trip REFERENCE, not its uuid — this app is never given the internal id.
      tripId: scan.trip_reference,
      recipientName: name.trim(),
      recipientIdNumber: idNumber.trim(),
    })

    if (dataUrl === null) {
      // No 2D context — fail here rather than confirm with an empty signature slot.
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
      // A failed confirm may have burned the token (redemption happens before the error
      // can surface), so the honest state is "this link is finished", not a retry.
      console.warn('[handover] confirm failed:', err)
      setStatus('invalid')
    }
  }, [scan, name, idNumber, token])

  const handleConsentProceed = useCallback(async (hasDocument: boolean) => {
    // Defensive guard — ConsentGate is only rendered once identity already holds.
    if (!hasRecipientIdentity(name, idNumber)) return

    if (hasDocument) {
      setStatus('verifying')
      try {
        await recordConsent(token, consentPayloadText(), true)
        const started = await startVerification(token)
        if (started.session_url !== null) {
          // Stashed before leaving — window.location.assign destroys this component.
          stashIdentity({ name, idNumber, token })
          window.location.assign(started.session_url)
          return
        }
        // Null session_url is a degraded tier (quota spent, vendor down), never an error.
        setStatus('ready')
      } catch (err: unknown) {
        // A vendor outage must never leave a receiver unable to confirm a real delivery.
        console.warn('[handover] verification start failed:', err)
        setStatus('ready')
      }
      return
    }

    setConsentBusy(true)
    try {
      await recordConsent(token, consentPayloadText(), false)
      setStatus('selfie')
    } catch (err: unknown) {
      console.warn('[handover] consent record failed:', err)
      setStatus('ready')
    } finally {
      setConsentBusy(false)
    }
  }, [name, idNumber, token])

  const handleConsentDecline = useCallback(async () => {
    setConsentBusy(true)
    try {
      await recordConsent(token, consentPayloadText(), false)
    } catch (err: unknown) {
      // Declining must still leave the receiver able to confirm the delivery.
      console.warn('[handover] consent decline record failed:', err)
    } finally {
      setConsentBusy(false)
      setStatus('ready')
    }
  }, [token])

  const handleSelfieCaptured = useCallback((dataUrl: string) => {
    setSelfiePhoto(dataUrl)
    setStatus('ready')
  }, [])

  const handleSelfieSkip = useCallback(() => {
    setStatus('ready')
  }, [])

  // Shared by both the consent screen and the ready screen.
  const showIdShapeHint = idNumber.trim().length > 0 && !looksLikeSaIdNumber(idNumber)

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

  if (status === 'verifying') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium text-neutral-900">Taking you to the identity check</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          You&apos;ll be sent to our verification provider for a moment, then brought back
          here to confirm the delivery.
        </p>
      </main>
    )
  }

  if (status === 'consent' || status === 'selfie') {
    const identityKnown = hasRecipientIdentity(name, idNumber)

    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-medium text-neutral-900">Confirm this delivery</h1>
          <p className="text-sm text-neutral-600">
            {scan?.destination_name} · {scan?.trip_reference}
          </p>
        </header>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-900">Your full name</span>
            <input
              className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
              value={name}
              autoComplete="off"
              disabled={consentBusy}
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
              disabled={consentBusy}
              onChange={(e) => setIdNumber(e.target.value)}
            />
            {showIdShapeHint && (
              <span className="text-xs text-neutral-500">
                This is not a 13 digit SA ID number. It will still be recorded as entered.
              </span>
            )}
          </label>
        </div>

        {status === 'selfie' ? (
          <SelfieCapture onCaptured={handleSelfieCaptured} onSkip={handleSelfieSkip} />
        ) : identityKnown ? (
          <ConsentGate
            onProceed={(hasDocument) => { void handleConsentProceed(hasDocument) }}
            onDecline={() => { void handleConsentDecline() }}
            busy={consentBusy}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            Enter your name and ID number above to continue.
          </p>
        )}
      </main>
    )
  }

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
