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
// must not leave the delivery unconfirmable — the fix is valuable evidence, not a
// precondition, so the swipe proceeds without one rather than hanging on it.
const GEO_TIMEOUT_MS = 8_000

// The typed identity has to survive a full navigation to the vendor's domain and back.
// React state does not — the page is destroyed and rebuilt — and without it
// resolveVerification would cross-check the vendor's extracted document against two empty
// strings. That reports "nothing to compare" rather than a mismatch, which silently
// disables the substitution defence the cross-check exists for: a receiver could forward
// the vendor link to a confederate who completes it with their own genuine ID, and nothing
// would notice.
//
// sessionStorage, not localStorage: it dies with the tab, which is the right lifetime for
// a stranger's ID number on a device we do not own. Every access is wrapped because
// private-browsing modes throw on access rather than returning null.
const IDENTITY_STASH_KEY = 'fp_handover_identity'

interface StashedIdentity {
  name: string
  idNumber: string
  /** Where to come back to. The mock vendor page has only a session id in its URL and no
      capability token, so the return path has to travel with the identity. */
  token: string
}

function stashIdentity(identity: StashedIdentity): void {
  try {
    sessionStorage.setItem(IDENTITY_STASH_KEY, JSON.stringify(identity))
  } catch {
    // Storage unavailable. The cross-check degrades to "nothing to compare", which is
    // recorded honestly as that rather than as a mismatch.
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
    // Nothing to clear, or storage is unavailable. Either way there is nothing to do.
  }
}

// 'consent' / 'verifying' / 'selfie' sit between 'loading' and 'ready' — the identity check
// FP-249 adds. None of them may become a dead end: every path out of them lands back on
// 'ready' (or, for 'done'/'invalid', somewhere the existing flow already handles).
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
  // Busy flag for ConsentGate's own `busy` prop, distinct from `status`: the "no ID" and
  // "decline" paths stay on the consent screen while their recordConsent call is in
  // flight, so the screen needs its own in-progress indicator rather than a page swap.
  const [consentBusy, setConsentBusy] = useState(false)
  // Tier-3 artifact only — held here so it isn't lost between capture and the confirm
  // swipe. There is no upload endpoint for it yet; wiring it to the backend is a
  // follow-up, not part of this stage.
  const [selfiePhoto, setSelfiePhoto] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadScan(): Promise<void> {
      const res = await fetchScan(token)
      if (cancelled) return
      setScan(res)

      if (res.verification === null) {
        // First load, never consented yet.
        setStatus('consent')
        return
      }

      if (res.verification.status === 'pending') {
        // Returning from the vendor's redirect. The name/ID typed before departing are
        // what the vendor's extracted identity gets cross-checked against — if this
        // browser context lost them, resolveVerification below has nothing to compare
        // and the check degrades rather than blocking the delivery, which is correct.
        // Recovered from sessionStorage, not from React state: this is a fresh page load
        // created by the vendor's redirect, so the state that held these is long gone.
        const stashed = readStashedIdentity()
        if (stashed !== null && !cancelled) {
          setName(stashed.name)
          setIdNumber(stashed.idNumber)
        }
        try {
          await resolveVerification(token, stashed?.name ?? name, stashed?.idNumber ?? idNumber)
        } catch (err: unknown) {
          // A failed resolve must never strand the receiver mid-check — the delivery
          // still happened and still has to be confirmable.
          console.warn('[handover] verification resolve failed:', err)
        }
        // Cleared whether or not the resolve succeeded: a retained ID number on someone
        // else's phone is a liability, and it has already served its only purpose.
        clearStashedIdentity()
        if (!cancelled) setStatus('ready')
        return
      }

      // Verification already settled (verified / failed / unverified) — nothing left to do.
      setStatus('ready')
    }

    loadScan().catch((err: unknown) => {
      if (cancelled) return
      // Every failure lands here identically, including a network error. Telling a
      // receiver with no signal that their link is invalid is a small lie; telling a
      // prober which of their guesses was live is a security hole. The lie is cheaper.
      console.warn('[handover] scan lookup failed:', err)
      setStatus('invalid')
    })
    return () => { cancelled = true }
    // Deliberately depends only on `token`. name/idNumber are read here solely as the
    // resume-from-vendor fallback (readStashedIdentity above is the primary source), and at
    // the point this mount effect fires they can only be their initial empty-string values
    // — nothing has set them yet. Listing them as deps would make this effect re-run on
    // every keystroke in the name/ID fields on the 'ready' screen, re-fetching the scan and
    // re-invoking resolveVerification/clearStashedIdentity for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleConsentProceed = useCallback(async (hasDocument: boolean) => {
    // Identity must exist before either recordConsent or startVerification — the vendor
    // cross-check compares against these values, and an empty string would compare
    // against nothing and silently report no mismatch. ConsentGate is only rendered once
    // this already holds (see the 'consent' screen below), so this is a defensive guard,
    // not the primary gate.
    if (!hasRecipientIdentity(name, idNumber)) return

    if (hasDocument) {
      // Moves off the consent screen immediately — a vendor call can take a moment, and
      // there is nothing left for ConsentGate's own busy state to do once we've left it.
      setStatus('verifying')
      try {
        await recordConsent(token, consentPayloadText(), true)
        const started = await startVerification(token)
        if (started.session_url !== null) {
          // Stashed immediately before leaving: once window.location.assign fires, this
          // component and all its state cease to exist.
          stashIdentity({ name, idNumber, token })
          window.location.assign(started.session_url)
          return
        }
        // Null session_url is a degraded tier (quota spent, vendor down, no document
        // detected), never an error — the reason is recorded server-side, not shown here.
        setStatus('ready')
      } catch (err: unknown) {
        // A vendor outage or network blip must never leave a receiver unable to confirm a
        // delivery that physically happened.
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
      // Declining consent must still leave the receiver able to confirm the delivery.
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

  // Computed unconditionally: the consent screen and the ready screen both show this hint
  // against the same shared name/idNumber state.
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
          // resolveVerification and recordConsent both cross-check or attribute against
          // these fields — ConsentGate stays off-screen until there's something to check.
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
