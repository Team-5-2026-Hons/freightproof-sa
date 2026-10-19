'use client'

import { useState } from 'react'
import { PackError, requestEmailCode, verifyEmailCode } from '@/lib/api'

// Shown instead of the pack when it was issued to an email address and this browser has
// not yet entered the code sent there (FP-291). The code is never sent automatically on
// page load: a link opened by a mail scanner or a link preview must not spend the
// recipient's code allowance or fill their inbox.

const CODE_LENGTH = 6

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

export function EmailCodeGate({ token, emailHint, onVerified }: EmailCodeGateProps) {
  const [step, setStep] = useState<Step>({ kind: 'start' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function send(): Promise<void> {
    setError(null)
    setStep({ kind: 'sending' })
    try {
      const sent = await requestEmailCode(token)
      setStep({ kind: 'sent', emailHint: sent.email_hint })
    } catch (err: unknown) {
      // A 429 means a code is already on its way, so the entry box is still the right screen.
      const alreadySent = err instanceof PackError && err.status === 429
      setStep(alreadySent ? { kind: 'sent', emailHint } : { kind: 'start' })
      setError(messageFor(err, 'The code could not be sent. Check your connection and try again.'))
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
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">FreightProof audit pack</p>
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
            className="rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={code.length !== CODE_LENGTH || step.kind === 'verifying'}
          >
            {step.kind === 'verifying' ? 'Checking…' : 'Open pack'}
          </button>
          <button
            type="button"
            className="text-sm font-semibold text-sec underline disabled:opacity-40"
            disabled={step.kind === 'verifying'}
            onClick={() => void send()}
          >
            Send a new code
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={step.kind === 'sending'}
          onClick={() => void send()}
        >
          {step.kind === 'sending' ? 'Sending…' : 'Email me a code'}
        </button>
      )}

      {error && <p role="alert" className="text-sm text-err">{error}</p>}
    </main>
  )
}
