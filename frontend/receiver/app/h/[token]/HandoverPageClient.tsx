// The receiver's whole experience. Opened from a QR by someone with no account, no app
// and no prior relationship with this system, usually one-handed on a warehouse floor.
//
// Deliberately incurious about WHY a token is invalid: the API returns one generic 404
// for expired/unknown/retired/redeemed/wrong-browser alike so it can't be used as an
// oracle to probe for live tokens, and this client must not undo that by explaining.
// That generic "no longer valid" screen is for a 404 ONLY. A dropped connection or a
// server fault says nothing about the token, so it gets its own "couldn't reach the
// server" screen with a retry — telling someone their link is dead because their signal
// dipped would send them off to fetch a fresh code for no reason.
'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Swipe } from '@/components/Swipe'
import { ConsentGate } from '@/components/ConsentGate'
import {
  confirmHandover,
  fetchScan,
  HandoverError,
  isTokenRejected,
  isTransientFailure,
  recordConsent,
  recordConsentDecline,
  resolveVerification,
  startVerification,
  type HandoverScan,
} from '@/lib/api'
import { consentPayloadText } from '@/lib/consent'
import {
  clearStashedIdentity,
  readConfirmOutcome,
  readStashedIdentity,
  rememberConfirmOutcome,
  stashIdentity,
  type StashedIdentity,
} from '@/lib/identity-stash'
import { MAX_RECEIVER_ID_NUMBER_LENGTH, MAX_RECEIVER_NAME_LENGTH } from '@/lib/limits'
import { ATTESTATION_SUBTITLE, renderAttestation } from '@shared/lib/utils/render-attestation'
import { hasRecipientIdentity, looksLikeSaIdNumber } from '@shared/lib/utils/sa-id'
import type { PositionFix } from '@shared/lib/types/position'

// Ceiling on the browser geolocation prompt. A receiver who ignores the permission dialog
// must not leave the delivery unconfirmable, so the swipe proceeds without a fix rather
// than hanging on one.
const GEO_TIMEOUT_MS = 8_000

// The browser's own `timeout` option above only starts counting once permission has been
// granted, so on its own it never fires for a receiver who leaves the prompt unanswered.
// This is how long we wait for them to answer it before giving up on a fix.
const GEO_PERMISSION_GRACE_MS = 7_000

// The server decides whether a code is still good (it may have extended the expiry), so
// the client only ever warns. The grace absorbs a phone clock that runs a little fast.
const EXPIRY_SKEW_GRACE_MS = 60_000

// How often the expiry check re-reads the clock. Bounded so a backgrounded tab, whose
// timers are throttled, notices soon after it returns, and so a far-future expiry never
// overflows setTimeout's 32-bit delay limit.
const EXPIRY_RECHECK_MS = 30_000

// Enough waybills to recognise the delivery by; a trip with dozens would otherwise push
// the identity fields and the swipe off the screen.
const MAX_WAYBILLS_COLLAPSED = 5

const MS_PER_SECOND = 1_000

const EXPIRY_NOTICE =
  'This code may have expired. If the confirmation is refused, ask the driver for a fresh one.'
const IDENTITY_CHECK_UNAVAILABLE_NOTICE =
  "We couldn't start the identity check. You can still confirm the delivery."
const IDENTITY_RESULT_UNAVAILABLE_NOTICE =
  "We couldn't finish the identity check. You can still confirm the delivery."
const SIGNATURE_FAILED_MESSAGE =
  'The signature could not be generated on this device. Please try again.'
const CONNECTION_RETRY_MESSAGE =
  "We couldn't reach the server. Check your connection and swipe again."
const RATE_LIMITED_MESSAGE = 'Too many attempts. Please wait a moment and swipe again.'
const GENERIC_RETRY_MESSAGE = 'Something went wrong. Please swipe again.'
const MAY_HAVE_CONFIRMED_NOTE =
  "If you already swiped, the delivery may have been confirmed — the driver's screen will show it."

const NOTICE_CLASS = 'rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700'
const TEXT_INPUT_CLASS = 'rounded-lg border border-neutral-300 px-3 py-3 text-base'

// 'consent' / 'verifying' / 'resolving' sit between 'loading' and 'ready'. None may become
// a dead end — every path out of them lands back on 'ready'.
type Status =
  | 'loading'
  | 'unreachable'
  | 'invalid'
  | 'consent'
  | 'verifying'
  | 'resolving'
  | 'ready'
  | 'signing'
  | 'done'

/**
 * Resolves to a fix, or to null on refusal, failure or timeout. Never rejects and never
 * hangs: it carries its own deadline because the browser's does not start until permission
 * is granted.
 */
function capturePosition(): Promise<PositionFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    const deadline = window.setTimeout(() => resolve(null), GEO_TIMEOUT_MS + GEO_PERMISSION_GRACE_MS)
    const settle = (fix: PositionFix | null): void => {
      window.clearTimeout(deadline)
      resolve(fix)
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => settle({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      }),
      // A denied permission and a failed fix are the same outcome here: no position.
      () => settle(null),
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

/**
 * Only follow a vendor URL that is https, or on this very origin (the dev mock page).
 * `session_url` comes over the wire, and window.location.assign will happily run a
 * `javascript:` URL, so it is parsed and checked rather than trusted.
 */
function resolveSafeRedirect(rawUrl: string | null): string | null {
  if (rawUrl === null) return null
  let parsed: URL
  try {
    parsed = new URL(rawUrl, window.location.origin)
  } catch {
    console.warn('[handover] vendor session_url could not be parsed')
    return null
  }
  // The http check matters because an opaque origin ("null") compares equal to another
  // opaque origin, which would otherwise let a javascript: or data: URL through.
  const isSameOriginWebUrl =
    parsed.origin === window.location.origin &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
  if (parsed.protocol === 'https:' || isSameOriginWebUrl) return rawUrl
  // The protocol only: the rest of the URL is a live vendor session.
  console.warn('[handover] refusing a vendor redirect with protocol', parsed.protocol)
  return null
}

function formatClockTime(date: Date): string {
  // Device zone on purpose: the receiver reads this against their own wall clock.
  return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

/** What the receiver is told after a confirm attempt that did not end in a verdict on the token. */
function describeConfirmFailure(err: unknown): string {
  if (!(err instanceof HandoverError)) return GENERIC_RETRY_MESSAGE
  if (err.retryAfterMs !== undefined) {
    const seconds = Math.max(1, Math.ceil(err.retryAfterMs / MS_PER_SECOND))
    return `Please wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} and try again.`
  }
  // A 429 without a readable Retry-After (a cross-origin browser may not be shown the
  // header) is still not a connection problem.
  if (err.status === 429) return RATE_LIMITED_MESSAGE
  if (isTransientFailure(err)) return CONNECTION_RETRY_MESSAGE
  // Any other 4xx (a 422, say): the server's own words. api.ts has already reduced them to
  // the validation messages, with nothing the receiver typed echoed back.
  return err.message
}

interface IdentityFieldsProps {
  name: string
  idNumber: string
  onNameChange: (value: string) => void
  onIdNumberChange: (value: string) => void
  disabled: boolean
  showIdShapeHint: boolean
}

// One definition for the consent and ready screens, which previously carried two copies
// that had to be kept in step by hand.
function IdentityFields({
  name,
  idNumber,
  onNameChange,
  onIdNumberChange,
  disabled,
  showIdShapeHint,
}: IdentityFieldsProps) {
  const idHintId = useId()
  const idInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-900">Your full name</span>
        <input
          className={TEXT_INPUT_CLASS}
          value={name}
          autoComplete="off"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_RECEIVER_NAME_LENGTH}
          enterKeyHint="next"
          disabled={disabled}
          onChange={(e) => onNameChange(e.target.value)}
          // The keyboard's "Next" key does nothing by itself outside a form. Not while an
          // input-method composition is open: there Enter commits the text being composed.
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            idInputRef.current?.focus()
          }}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-900">Your ID number</span>
          {/* Not inputMode="numeric": passports and company registrations contain letters,
              and the API accepts them. */}
          <input
            ref={idInputRef}
            className={`${TEXT_INPUT_CLASS} tabular-nums`}
            value={idNumber}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_RECEIVER_ID_NUMBER_LENGTH}
            aria-describedby={showIdShapeHint ? idHintId : undefined}
            disabled={disabled}
            onChange={(e) => onIdNumberChange(e.target.value)}
          />
        </label>
        {showIdShapeHint && (
          <p id={idHintId} className="text-xs text-neutral-500">
            This is not a 13 digit SA ID number. It will still be recorded as entered.
          </p>
        )}
      </div>
    </div>
  )
}

interface ScreenHeaderProps {
  scan: HandoverScan | null
  codeMayHaveExpired: boolean
}

function ScreenHeader({ scan, codeMayHaveExpired }: ScreenHeaderProps) {
  const expiresAt = scan === null ? null : new Date(scan.expires_at)
  const validUntil =
    expiresAt !== null && !Number.isNaN(expiresAt.getTime()) ? formatClockTime(expiresAt) : null

  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-medium text-neutral-900">Confirm this delivery</h1>
      {/* min-w-0 + break-words: a destination name with no spaces must wrap, not widen the page. */}
      <p className="min-w-0 break-words text-sm tabular-nums text-neutral-600">
        {scan?.destination_name} · {scan?.trip_reference}
      </p>
      {validUntil !== null && (
        <p className="text-sm text-neutral-600">This code is valid until {validUntil}</p>
      )}
      {codeMayHaveExpired && (
        <p role="status" className={`mt-1 ${NOTICE_CLASS}`}>{EXPIRY_NOTICE}</p>
      )}
    </header>
  )
}

function WaybillList({ references }: { references: string[] }) {
  const [showAll, setShowAll] = useState(false)
  const isCollapsible = references.length > MAX_WAYBILLS_COLLAPSED
  const visible = isCollapsible && !showAll ? references.slice(0, MAX_WAYBILLS_COLLAPSED) : references

  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-900">Waybills</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-sm tabular-nums text-neutral-600">
        {visible.map((ref) => <li key={ref} className="break-words">{ref}</li>)}
      </ul>
      {isCollapsible && (
        <button
          type="button"
          className="mt-2 py-1 text-sm text-neutral-700 underline"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show fewer' : `Show all ${references.length}`}
        </button>
      )}
    </section>
  )
}

export function HandoverPageClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('loading')
  const [scan, setScan] = useState<HandoverScan | null>(null)
  const [name, setName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  // Red, role="alert": something the receiver must act on.
  const [message, setMessage] = useState('')
  // Neutral, role="status": something we couldn't do that does NOT stop them confirming.
  const [notice, setNotice] = useState('')
  // A confirm left this device and no verdict came back, so the "link is invalid" screen
  // must not rule out that it already worked.
  const [mayHaveConfirmed, setMayHaveConfirmed] = useState(false)
  const [codeMayHaveExpired, setCodeMayHaveExpired] = useState(false)
  // Bumped by "Try again" to re-run the scan effect.
  const [scanAttempt, setScanAttempt] = useState(0)
  // Consent-record call in flight; ConsentGate stays on screen.
  const [consentBusy, setConsentBusy] = useState(false)

  // The vendor round trip's stash is read and cleared exactly once per mount, then kept
  // here. Reading it on every effect run would lose it: React StrictMode runs the effect
  // twice in development and "Try again" runs it again, and by then it has been cleared.
  const hasReadStashRef = useRef(false)
  const stashedIdentityRef = useRef<StashedIdentity | null>(null)

  // Read by the pageshow listener below, which is registered once.
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  // Back from the vendor's page restores this one from the back/forward cache exactly as it
  // was left: on "Taking you to the identity check", with no navigation coming, stuck. The
  // receiver backed out of the check, so put them back at the choice they made, and drop
  // the identity stashed for a vendor return that will now never happen.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted || statusRef.current !== 'verifying') return
      clearStashedIdentity()
      setStatus('consent')
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  useEffect(() => {
    let cancelled = false

    // Read FIRST, before anything can fail, and cleared unconditionally: a retained ID
    // number on someone else's phone is a liability, whether or not it is used.
    if (!hasReadStashRef.current) {
      hasReadStashRef.current = true
      stashedIdentityRef.current = readStashedIdentity()
      clearStashedIdentity()
    }
    // A stash left by a different delivery is ignored — it must never be applied here.
    const stashed = stashedIdentityRef.current
    const returning = stashed !== null && stashed.token === token ? stashed : null

    async function loadScan(): Promise<void> {
      const res = await fetchScan(token)
      if (cancelled) return
      setScan(res)
      if (returning !== null) {
        setName(returning.name)
        setIdNumber(returning.idNumber)
      }

      if (res.verification === null) {
        setStatus('consent')
        return
      }

      // Back from the vendor, the decision may ALREADY be final — the webhook can beat the
      // receiver's return. The typed-identity cross-check only happens inside resolve, so
      // skipping it for a non-pending verification would let a different person's
      // approved document stand unchecked. Without a stash we cannot know it was a
      // return, so only a pending verification is resolved, with nothing typed to compare.
      if (returning === null && res.verification.status !== 'pending') {
        setStatus('ready')
        return
      }

      setStatus('resolving')
      try {
        await resolveVerification(token, returning?.name ?? '', returning?.idNumber ?? '')
      } catch (err: unknown) {
        // A failed resolve must never strand the receiver mid-check.
        console.warn('[handover] verification resolve failed:', err)
        if (!cancelled) setNotice(IDENTITY_RESULT_UNAVAILABLE_NOTICE)
      }
      if (!cancelled) setStatus('ready')
    }

    loadScan().catch((err: unknown) => {
      if (cancelled) return
      console.warn('[handover] scan lookup failed:', err)

      // Only a 404 is the generic "this link is finished" answer; anything else is the
      // network or the server, and a retry may well work.
      if (!isTokenRejected(err)) {
        setStatus('unreachable')
        return
      }

      // A redeemed token reads exactly like a dead one, so a receiver who already
      // confirmed and then reloaded would be told their link is invalid. This device
      // remembers what it did.
      const outcome = readConfirmOutcome(token)
      if (outcome === 'confirmed') {
        setStatus('done')
        return
      }
      setMayHaveConfirmed(outcome === 'attempted')
      setStatus('invalid')
    })

    return () => { cancelled = true }
  }, [token, scanAttempt])

  const retryScan = useCallback(() => {
    setStatus('loading')
    setScanAttempt((attempt) => attempt + 1)
  }, [])

  const expiresAtMs = useMemo(() => {
    if (scan === null) return null
    const parsed = Date.parse(scan.expires_at)
    return Number.isNaN(parsed) ? null : parsed
  }, [scan])

  // Warn only — never blocks the swipe. The server may have extended the expiry.
  useEffect(() => {
    if (expiresAtMs === null) return
    const deadline = expiresAtMs + EXPIRY_SKEW_GRACE_MS
    let timer: number | undefined

    const check = (): void => {
      const remaining = deadline - Date.now()
      setCodeMayHaveExpired(remaining <= 0)
      if (remaining > 0) timer = window.setTimeout(check, Math.min(remaining, EXPIRY_RECHECK_MS))
    }
    // Deferred rather than called here, so the first read isn't a synchronous setState in an effect.
    timer = window.setTimeout(check, 0)

    return () => window.clearTimeout(timer)
  }, [expiresAtMs])

  const handleSign = useCallback(async () => {
    if (scan === null || !hasRecipientIdentity(name, idNumber)) return
    setStatus('signing')
    setMessage('')

    // Whatever happens below, 'signing' must not outlive this call: the swipe is busy for
    // exactly as long as it holds, and a stuck 'signing' leaves a stranger with a screen
    // that can never be confirmed.
    let nextStatus: Status = 'ready'
    try {
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
        subtitle: ATTESTATION_SUBTITLE.receiverDevice,
      })

      if (dataUrl === null) {
        // No 2D context — fail here rather than confirm with an empty signature slot.
        setMessage(SIGNATURE_FAILED_MESSAGE)
        return
      }

      // Recorded BEFORE the request leaves: if the response is lost the server may still
      // have redeemed the token, and a later reload needs to know an attempt was made.
      rememberConfirmOutcome(token, 'attempted')
      try {
        await confirmHandover(token, {
          receiver_name: name.trim(),
          receiver_id_number: idNumber.trim(),
          signature_png_base64: dataUrl,
          receiver_lat: fix?.lat ?? null,
          receiver_lng: fix?.lng ?? null,
          receiver_accuracy_m: fix?.accuracyM ?? null,
        })
        rememberConfirmOutcome(token, 'confirmed')
        nextStatus = 'done'
      } catch (err: unknown) {
        console.warn('[handover] confirm failed:', err)
        if (isTokenRejected(err)) {
          // The token is finished, and we did send an attempt, so it may be the one that landed.
          setMayHaveConfirmed(true)
          nextStatus = 'invalid'
        } else {
          // No verdict on the token: keep what they typed and let them swipe again.
          setMessage(describeConfirmFailure(err))
        }
      }
    } catch (err: unknown) {
      // Reached by a throw before the request (renderAttestation, an odd geolocation
      // implementation), not by a failed confirm.
      console.warn('[handover] signing failed before the request was sent:', err)
      setMessage(SIGNATURE_FAILED_MESSAGE)
    } finally {
      setStatus(nextStatus)
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
        const sessionUrl = resolveSafeRedirect(started.session_url)
        if (sessionUrl !== null) {
          // Stashed before leaving — window.location.assign destroys this component.
          stashIdentity({ name, idNumber, token })
          window.location.assign(sessionUrl)
          return
        }
        // Null session_url is a degraded tier (quota spent, vendor down), never an error;
        // an unusable one is treated the same. Either way the receiver is told, not left
        // to wonder where the identity check went.
        setNotice(IDENTITY_CHECK_UNAVAILABLE_NOTICE)
        setStatus('ready')
      } catch (err: unknown) {
        // A vendor outage must never leave a receiver unable to confirm a real delivery.
        console.warn('[handover] verification start failed:', err)
        setNotice(IDENTITY_CHECK_UNAVAILABLE_NOTICE)
        setStatus('ready')
      }
      return
    }

    setConsentBusy(true)
    try {
      await recordConsent(token, consentPayloadText(), false)
      // No document: confirm as typed-only.
      setStatus('ready')
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
      // A decline, not a consent with no document: agreeing without an ID is a different
      // decision from refusing the check, and the record must not blur them.
      await recordConsentDecline(token, consentPayloadText())
    } catch (err: unknown) {
      // Declining must still leave the receiver able to confirm the delivery.
      console.warn('[handover] consent decline record failed:', err)
    } finally {
      setConsentBusy(false)
      setStatus('ready')
    }
  }, [token])

  const showIdShapeHint = idNumber.trim().length > 0 && !looksLikeSaIdNumber(idNumber)

  if (status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-base text-neutral-500">Loading delivery…</p>
      </main>
    )
  }

  if (status === 'unreachable') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium text-neutral-900">We couldn&apos;t reach the server</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          Check your signal or Wi-Fi, then try again.
        </p>
        <button
          type="button"
          className="mt-2 rounded-lg bg-neutral-900 px-6 py-3.5 text-base font-medium text-white"
          onClick={retryScan}
        >
          Try again
        </button>
      </main>
    )
  }

  if (status === 'invalid') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium text-neutral-900">This link is no longer valid</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          Ask the driver to show you a fresh code. Codes refresh regularly, each one can
          only be used once, and a code has to be opened in the same browser that first
          scanned it.
        </p>
        {mayHaveConfirmed && (
          <p className="max-w-sm text-sm text-neutral-600">{MAY_HAVE_CONFIRMED_NOTE}</p>
        )}
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

  if (status === 'resolving') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-base text-neutral-500">Checking your identity result…</p>
      </main>
    )
  }

  if (status === 'consent') {
    const identityKnown = hasRecipientIdentity(name, idNumber)

    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-5">
        <ScreenHeader scan={scan} codeMayHaveExpired={codeMayHaveExpired} />

        <IdentityFields
          name={name}
          idNumber={idNumber}
          onNameChange={setName}
          onIdNumberChange={setIdNumber}
          disabled={consentBusy}
          showIdShapeHint={showIdShapeHint}
        />

        {identityKnown ? (
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
      <ScreenHeader scan={scan} codeMayHaveExpired={codeMayHaveExpired} />

      {notice !== '' && <p role="status" className={NOTICE_CLASS}>{notice}</p>}

      {scan !== null && scan.waybill_references.length > 0 && (
        <WaybillList references={scan.waybill_references} />
      )}

      <IdentityFields
        name={name}
        idNumber={idNumber}
        onNameChange={setName}
        onIdNumberChange={setIdNumber}
        disabled={isSigning}
        showIdShapeHint={showIdShapeHint}
      />

      <div className="rounded-xl border border-neutral-200 p-4">
        <p className="text-base font-medium text-neutral-900">By signing, you confirm:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-neutral-600">
          <li>The delivery was received</li>
          <li>Your name and ID number are recorded</li>
          <li>The time of signing is recorded</li>
          <li>Your device&apos;s location is recorded, if you allow it</li>
        </ul>
      </div>

      {message !== '' && <p role="alert" className="text-sm text-red-600">{message}</p>}

      <div className="mt-auto pb-6">
        <Swipe
          label={isSigning ? 'Confirming…' : 'Swipe to confirm delivery'}
          disabled={!hasRecipientIdentity(name, idNumber)}
          busy={isSigning}
          onConfirm={handleSign}
        />
      </div>
    </main>
  )
}
