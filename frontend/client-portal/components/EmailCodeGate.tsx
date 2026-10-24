'use client'

import { useEffect, useRef, useState } from 'react'
import { PackError, STORAGE_BLOCKED_NOTICE, requestEmailCode, storageBlocked, verifyEmailCode } from '@/lib/api'
import { Eyebrow } from './Eyebrow'

// Shown instead of the pack when it was issued to an email address and this browser has
// not yet entered the code sent there. The code is never sent automatically on
// page load: a link opened by a mail scanner or a link preview must not spend the
// recipient's code allowance or fill their inbox.

const CODE_LENGTH = 6
const HTTP_TOO_MANY_REQUESTS = 429
// The backend refuses a second code inside 60 s (RESEND_COOLDOWN in email_codes.py), and its
// per-IP limiter works in one-minute windows, so a minute is the right wait either way. The
// server's Retry-After header would be better, but the API does not expose it to browsers (CORS).
const RESEND_COOLDOWN_MS = 60_000
// A 429 means two different things and only the body tells them apart. This opening is the
// backend's EmailCodeRequestTooSoon detail ("A code was sent a moment ago. …"); the per-IP
// limiter's body ("Too many requests. …") does not start with it.
const CODE_ALREADY_SENT_PREFIX = 'A code was sent'
const WAIT_HINT = 'Try again in about a minute.'

type Step =
  | { kind: 'start' }
  | { kind: 'sending' }
  | { kind: 'sent'; emailHint: string }
  | { kind: 'verifying'; emailHint: string }

interface EmailCodeGateProps {
  token: string
  emailHint: string
  onVerified: () => void
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof PackError ? err.message : fallback
}

function isCodeAlreadySent(err: unknown): boolean {
  return err instanceof PackError && err.status === HTTP_TOO_MANY_REQUESTS && err.message.startsWith(CODE_ALREADY_SENT_PREFIX)
}

export function EmailCodeGate({ token, emailHint, onVerified }: EmailCodeGateProps) {
  const [step, setStep] = useState<Step>({ kind: 'start' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [coolingDown, setCoolingDown] = useState(false)
  const cooldownTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current)
  }, [])

  function startCooldown(): void {
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current)
    setCoolingDown(true)
    cooldownTimer.current = window.setTimeout(() => setCoolingDown(false), RESEND_COOLDOWN_MS)
  }

  async function send(): Promise<void> {
    // Where to return if this send fails: a recipient already looking at the code box keeps it,
    // because the code they were sent earlier is still the live one.
    const before: Step = step.kind === 'sent' || step.kind === 'verifying' ? { kind: 'sent', emailHint: step.emailHint } : { kind: 'start' }
    setError(null)
    setStep({ kind: 'sending' })
    try {
      const sent = await requestEmailCode(token)
      setStep({ kind: 'sent', emailHint: sent.email_hint })
      startCooldown()
    } catch (err: unknown) {
      console.warn('Could not request an emailed code', err)
      setError(messageFor(err, 'The code could not be sent. Check your connection and try again.'))
      if (isCodeAlreadySent(err)) {
        // The backend says a code is already on its way, so the entry box is the right screen.
        setStep({ kind: 'sent', emailHint: before.kind === 'sent' ? before.emailHint : emailHint })
        startCooldown()
        return
      }
      setStep(before)
      // The generic per-IP limit: asking again straight away would only be refused again.
      if (err instanceof PackError && err.status === HTTP_TOO_MANY_REQUESTS) startCooldown()
    }
  }

  async function verify(): Promise<void> {
    if (step.kind !== 'sent' || code.length !== CODE_LENGTH) return
    setError(null)
    setStep({ kind: 'verifying', emailHint: step.emailHint })
    try {
      await verifyEmailCode(token, code)
      onVerified()
    } catch (err: unknown) {
      console.warn('The emailed code was not accepted', err)
      setStep({ kind: 'sent', emailHint: step.emailHint })
      setCode('')
      setError(messageFor(err, 'The code could not be checked. Check your connection and try again.'))
    }
  }

  const awaitingCode = step.kind === 'sent' || step.kind === 'verifying'
  const shownHint = awaitingCode ? step.emailHint : emailHint

  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-20">
      <div>
        <Eyebrow size="micro">FreightProof audit pack</Eyebrow>
        <h1 className="mt-1 text-xl font-extrabold">Confirm it&apos;s you</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This pack was shared with <span className="num font-semibold text-ink">{shownHint}</span>. To open it, enter
          the one-time code we email to that address. You only need to do this once on this device.
        </p>
      </div>

      {awaitingCode ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">6-digit code</span>
            <input
              className="num rounded-md border border-outline-v px-3 py-3 text-lg tracking-[0.3em]"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              disabled={step.kind === 'verifying'}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={code.length !== CODE_LENGTH || step.kind === 'verifying'}
          >
            {step.kind === 'verifying' ? 'Checking…' : 'Open pack'}
          </button>
          <button
            type="button"
            className="min-h-11 py-2 text-sm font-semibold text-sec underline disabled:opacity-40"
            disabled={step.kind === 'verifying' || coolingDown}
            onClick={() => void send()}
          >
            Send a new code
          </button>
          {coolingDown && <p className="text-xs text-muted">You can ask for another code in about a minute.</p>}
        </form>
      ) : (
        <>
          <button
            type="button"
            className="min-h-11 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={step.kind === 'sending' || coolingDown}
            onClick={() => void send()}
          >
            {step.kind === 'sending' ? 'Sending…' : 'Email me a code'}
          </button>
          {coolingDown && <p className="text-xs text-muted">{WAIT_HINT}</p>}
        </>
      )}

      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      {storageBlocked() && <p className="text-xs text-muted">{STORAGE_BLOCKED_NOTICE}</p>}
    </main>
  )
}
