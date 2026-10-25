'use client'

import { useState } from 'react'
import { PackError, STORAGE_BLOCKED_NOTICE, storageBlocked, verifyPassword } from '@/lib/api'
import { Eyebrow } from './Eyebrow'

// Shown instead of the pack when it was issued to an email address: the link and a
// password were mailed there together at issue, and this browser has not yet entered
// that password. Unlike the old one-time code, the password is not sent from here —
// there is nothing to "send me one" for, since it already went out automatically.

function messageFor(err: unknown, fallback: string): string {
  return err instanceof PackError ? err.message : fallback
}

interface PasswordGateProps {
  token: string
  emailHint: string
  onVerified: () => void
}

export function PasswordGate({ token, emailHint, onVerified }: PasswordGateProps) {
  const [password, setPassword] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verify(): Promise<void> {
    if (password.length === 0 || verifying) return
    setError(null)
    setVerifying(true)
    try {
      await verifyPassword(token, password)
      onVerified()
    } catch (err: unknown) {
      console.warn('The mailed password was not accepted', err)
      setPassword('')
      setError(messageFor(err, 'The password could not be checked. Check your connection and try again.'))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-20">
      <div>
        <Eyebrow size="micro">FreightProof audit pack</Eyebrow>
        <h1 className="mt-1 text-xl font-extrabold">Confirm it&apos;s you</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This pack was shared with <span className="num font-semibold text-ink">{emailHint}</span>. Enter the
          password sent to that address to open it. You only need to do this once on this device.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void verify()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Password</span>
          <input
            className="rounded-md border border-outline-v px-3 py-3 text-lg"
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={verifying}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={password.length === 0 || verifying}
        >
          {verifying ? 'Checking…' : 'Open pack'}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      {storageBlocked() && <p className="text-xs text-muted">{STORAGE_BLOCKED_NOTICE}</p>}
    </main>
  )
}
