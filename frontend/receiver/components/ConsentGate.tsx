// frontend/receiver/components/ConsentGate.tsx
//
// The s27(1)(a) gate. Biometric processing is prohibited under POPIA s26 without an
// exemption, and explicit consent is the one this feature relies on — so this screen is a
// legal control, not a nicety.
//
// Two things it must never do: pre-tick the consent, or make declining feel like failure.
// The delivery is confirmable either way, and a receiver who feels cornered into a face
// scan has not given consent in any sense the Act recognises.
'use client'

import { useState } from 'react'
import { CONSENT_TEXT } from '@/lib/consent'

interface ConsentGateProps {
  onProceed: (hasDocument: boolean) => void
  onDecline: () => void
  busy: boolean
}

export function ConsentGate({ onProceed, onDecline, busy }: ConsentGateProps) {
  const [agreed, setAgreed] = useState(false)

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">Identity check</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">{CONSENT_TEXT}</p>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-4">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0"
          checked={agreed}
          disabled={busy}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span className="text-sm text-neutral-900">
          I agree to my identity document and photograph being checked.
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="rounded-lg bg-neutral-900 px-4 py-3.5 text-base font-medium text-white disabled:opacity-40"
          disabled={!agreed || busy}
          onClick={() => onProceed(true)}
        >
          {busy ? 'Starting…' : 'I have my ID with me'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-neutral-300 px-4 py-3.5 text-base text-neutral-900 disabled:opacity-40"
          disabled={!agreed || busy}
          onClick={() => onProceed(false)}
        >
          I don&apos;t have my ID with me
        </button>
        {/* Declining is a first-class outcome, not an escape hatch buried in small print.
            The delivery still confirms; only the strength of the evidence changes. */}
        <button
          type="button"
          className="px-4 py-3 text-sm text-neutral-500 underline disabled:opacity-40"
          disabled={busy}
          onClick={onDecline}
        >
          Skip the identity check
        </button>
      </div>
    </section>
  )
}
