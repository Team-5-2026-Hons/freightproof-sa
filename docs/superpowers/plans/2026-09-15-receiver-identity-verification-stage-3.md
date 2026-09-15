# Receiver Identity Verification — Stage 3 (Receiver UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

> **⚠ GIT RULE.** Never `git commit/push/merge/rebase/checkout/reset/restore/stash`.
> "Commit" steps **stage only**.

**Goal:** Put the verification flow in front of the receiver — consent gate, vendor
redirect, return handling, and the no-document fallback — so the feature is operable
end to end against the mock.

**Architecture:** `frontend/receiver` stays tiny and stateless. The capability token in the
URL is the only identity it holds. All verification state lives server-side and is read
back on mount, so a receiver who returns from the vendor in a fresh page load picks up
exactly where they were without the client remembering anything.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.5, Tailwind 3.4.

**Depends on:** Stage 2B (all four routes live).

---

## Known environment facts (tell every implementer)

- Backend interpreter `backend/.venv/bin/python`, tests `backend/.venv/bin/pytest`.
- **Active node is v18.20.7** but `package.json` requires `>=22 <23`. Node 22 is available
  at `~/.nvm/versions/node/v22.23.2/bin/node`. `tsc --noEmit` works on 18; use node 22 if
  anything else complains.
- **`frontend/receiver` has NO test harness** — no vitest, no jest. Verification for this
  stage is `npm run type-check` (tsc --noEmit) and `npm run lint`, plus the backend tests
  for anything server-side. Do NOT add vitest: `frontend/*/package.json` is a
  coordinate-before-changing file per CLAUDE.md. Flag the gap instead.
- Backend baseline: **1482 passed, 0 failed, 38 known errors** (analytics, PG14 vs
  `security_invoker` needing PG15+). Ignore those 38.
- Driver PWA note that does NOT apply here: `receiver` is a normal Next app, not
  `output: 'export'`, so Server Components are fine — but every file below is already
  `'use client'` and should stay that way.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/schemas/handover.py` *(modify)* | Add `verification` to `HandoverScanResponse` |
| `backend/app/api/v1/endpoints/handover.py` *(modify)* | Populate it in `scan_handover_endpoint` |
| `backend/tests/integration/test_receiver_verification_endpoints.py` *(modify)* | Cover the new block |
| `frontend/receiver/lib/api.ts` *(modify)* | consent / verify / resolve clients |
| `frontend/receiver/lib/consent.ts` *(create)* | The consent wording, versioned in one place |
| `frontend/receiver/components/ConsentGate.tsx` *(create)* | s27(1)(a) consent + "do you have your ID?" |
| `frontend/receiver/components/SelfieCapture.tsx` *(create)* | Tier-3 capture |
| `frontend/receiver/app/h/[token]/HandoverPageClient.tsx` *(modify)* | Orchestrate the states |

---

## Task 0: Expose verification state on the scan response

**Files:** `backend/app/schemas/handover.py`, `backend/app/api/v1/endpoints/handover.py`,
`backend/tests/integration/test_receiver_verification_endpoints.py`

Without this the client cannot distinguish a first load from a return-from-vendor, and
would have to remember state in the browser — which breaks precisely when the vendor
redirect lands in a fresh page context.

- [ ] **Step 1: Add the field to `HandoverScanResponse`**

```python
    # Null until the receiver consents. Non-null tells a returning browser what already
    # happened, so the page can resume without remembering anything itself — which matters
    # because the vendor redirect lands in a fresh page load with no client state.
    verification: Optional["HandoverVerificationState"] = None
```

`HandoverVerificationState` is defined **below** `HandoverScanResponse` in that file, so add
this after the last class so the forward reference resolves:

```python
HandoverScanResponse.model_rebuild()
```

- [ ] **Step 2: Populate it in `scan_handover_endpoint`**

Just before the `return HandoverScanResponse(...)`:

```python
    verification = await load_verification_for_token(db, token_id=token.id)
```

and add to the return:

```python
        verification=_verification_state(verification) if verification is not None else None,
```

- [ ] **Step 3: Test it** — append to `test_receiver_verification_endpoints.py`:

two tests — the scan response carries `verification: null` before consent, and carries a
`status`/`tier` block after consent. Follow the file's existing fixture style.

- [ ] **Step 4: Run**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_endpoints.py tests/integration/test_handover_endpoints.py -q
```

Expected: 29 passed (10 + 19).

- [ ] **Step 5: Stage** the three files.

---

## Task 1: Consent wording, versioned

**Files:** Create `frontend/receiver/lib/consent.ts`

- [ ] **Step 1: Write it**

```typescript
// frontend/receiver/lib/consent.ts
//
// The consent wording, in ONE place, because its SHA-256 is stored as evidence.
//
// POPIA s27(1)(a) is the exemption that makes a biometric identity check lawful here, and
// that exemption is only as good as proof of what the receiver actually agreed to. The
// server hashes this exact string and stores the digest — so editing this text changes the
// hash, and a dispute months later can tell which version a given receiver saw.
//
// Treat it as versioned content, not a UI string. If you change the wording, change
// CONSENT_VERSION with it so the two never drift.

export const CONSENT_VERSION = 'v1'

export const CONSENT_TEXT = [
  'To confirm this delivery we need to check your identity.',
  'You will be asked to photograph an identity document and take a photograph of your face.',
  'These images are sent to our verification provider, Didit, and are not stored by FreightProof.',
  'We keep only the result of the check, the time, and a reference number.',
  'You can decline. The delivery can still be confirmed without this check.',
].join(' ')

/** What the server hashes. Kept separate so the version travels with the wording. */
export function consentPayloadText(): string {
  return `${CONSENT_VERSION}: ${CONSENT_TEXT}`
}
```

- [ ] **Step 2: Stage.**

---

## Task 2: API client

**Files:** Modify `frontend/receiver/lib/api.ts`

- [ ] **Step 1: Append types and three calls**

```typescript
export interface VerificationState {
  status: 'pending' | 'verified' | 'failed' | 'unverified'
  tier: 'document_and_face' | 'selfie_only' | 'typed_only'
  unverified_reason: string | null
  identity_match: boolean | null
}

export interface VerifyStarted {
  /** Null on every degradation path — quota spent, vendor down, no document. NOT an error. */
  session_url: string | null
  tier: string
  unverified_reason: string | null
}

export async function recordConsent(
  token: string,
  consentText: string,
  hasDocument: boolean,
): Promise<VerificationState> {
  return parse<VerificationState>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ consent_text: consentText, has_document: hasDocument }),
    }),
  )
}

export async function startVerification(token: string): Promise<VerifyStarted> {
  return parse<VerifyStarted>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/verify`, {
      method: 'POST',
      credentials: 'include',
    }),
  )
}

/**
 * Ask the server to fetch the vendor's decision.
 *
 * Deliberately sends NO session identifier — the server uses the id it stored before
 * redirecting. A client that could name a session could point us at someone else's
 * approved one, and this route has no authentication by design.
 */
export async function resolveVerification(
  token: string,
  receiverName: string,
  receiverIdNumber: string,
): Promise<VerificationState> {
  const q = new URLSearchParams({
    receiver_name: receiverName,
    receiver_id_number: receiverIdNumber,
  })
  return parse<VerificationState>(
    await fetch(`${BASE_URL}/api/v1/handover/${token}/verify/resolve?${q}`, {
      method: 'POST',
      credentials: 'include',
    }),
  )
}
```

- [ ] **Step 2: Add `verification` to the existing `HandoverScan` interface**

```typescript
  verification: VerificationState | null
```

- [ ] **Step 3: Type-check**

```bash
cd frontend/receiver && npm run type-check
```

Expected: clean.

- [ ] **Step 4: Stage.**

---

## Task 3: Consent gate component

**Files:** Create `frontend/receiver/components/ConsentGate.tsx`

- [ ] **Step 1: Write it**

```tsx
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
```

- [ ] **Step 2: Type-check and stage.**

---

## Task 4: Selfie capture (tier 3)

**Files:** Create `frontend/receiver/components/SelfieCapture.tsx`

- [ ] **Step 1: Write it**

```tsx
// frontend/receiver/components/SelfieCapture.tsx
//
// Tier 3: the receiver has no document on them. We capture a photograph OURSELVES rather
// than sending them through the vendor.
//
// Two reasons, and both matter. It burns none of the 500-per-month free quota, so a
// document-less receiver never brings the hard stop closer for someone who does have
// theirs. And a stored photograph is ordinary personal information — it only becomes
// biometric processing under POPIA s26 when a technique is APPLIED to it, which we do not
// do here.
//
// Be honest about what this proves: a live human confirmed the delivery. Not who they are.
'use client'

import { useCallback, useRef, useState } from 'react'

interface SelfieCaptureProps {
  onCaptured: (dataUrl: string) => void
  onSkip: () => void
}

const CAPTURE_WIDTH = 640

export function SelfieCapture({ onCaptured, onSkip }: SelfieCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onerror = () => setError('That photo could not be read. Please try again.')
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => setError('That photo could not be read. Please try again.')
      img.onload = () => {
        // Downscaled before upload: a modern phone camera produces several megabytes, the
        // receiver is on mobile data in a warehouse, and nothing about this evidence needs
        // full resolution.
        const scale = Math.min(1, CAPTURE_WIDTH / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (ctx === null) {
          setError('This device cannot process the photo. You can continue without it.')
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        onCaptured(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }, [onCaptured])

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">Photo instead</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Without an ID document we can&apos;t verify your identity, but a photo records
          that you were here. This is optional.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {error !== '' && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="rounded-lg bg-neutral-900 px-4 py-3.5 text-base font-medium text-white"
          onClick={() => inputRef.current?.click()}
        >
          Take a photo
        </button>
        <button
          type="button"
          className="px-4 py-3 text-sm text-neutral-500 underline"
          onClick={onSkip}
        >
          Continue without a photo
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Type-check and stage.**

---

## Task 5: Orchestrate the flow

**Files:** Modify `frontend/receiver/app/h/[token]/HandoverPageClient.tsx`

The page gains states between `ready` and `signing`. Keep the existing `loading` /
`invalid` / `done` states and the existing sign-and-confirm logic **untouched** — that is
FP-155's working path.

- [ ] **Step 1: Extend the state machine**

New `Status` values: `'consent' | 'verifying' | 'selfie'`.

Flow rules, all of which matter:

1. On mount, after `fetchScan`, read `scan.verification`:
   - `null` → show `ConsentGate`.
   - `status === 'pending'` → the receiver is **returning from the vendor**. Call
     `resolveVerification(token, name, idNumber)`, then continue to the form.
   - anything else → verification already settled; go straight to the form.
2. `ConsentGate.onProceed(true)` → `recordConsent(…, true)` then `startVerification`.
   - `session_url` non-null → `window.location.assign(session_url)`.
   - `session_url` null → **not an error.** Continue to the form; the reason is recorded
     server-side.
3. `ConsentGate.onProceed(false)` → `recordConsent(…, false)` → `SelfieCapture`.
4. `ConsentGate.onDecline()` → `recordConsent(…, false)` → straight to the form.
5. **Every verification failure continues to the form.** A vendor outage must never leave a
   receiver unable to confirm a delivery that physically happened. Log and proceed.

- [ ] **Step 2: Name and ID must be collected BEFORE verification**

`resolveVerification` cross-checks the vendor's extracted identity against what the
receiver typed, so the typed values must exist by the time we resolve. Move the two input
fields above the consent gate, or collect them on the consent screen. Do not send empty
strings — the cross-check would compare against nothing and silently return "no mismatch".

- [ ] **Step 3: Type-check and lint**

```bash
cd frontend/receiver && npm run type-check && npm run lint
```

Both must be clean.

- [ ] **Step 4: Stage.**

---

## Task 6: End-to-end check against the mock

- [ ] **Step 1: Backend suite**

```bash
cd backend && .venv/bin/pytest -q
```

Expected: 1482 + Task 0's new tests passed, 0 failed, 38 known errors.

- [ ] **Step 2: Receiver app builds**

```bash
cd frontend/receiver && npm run type-check && npm run lint
```

- [ ] **Step 3: Report TASK COMPLETE**, flagging:
  - `frontend/receiver` has **no test harness** — this stage is type-checked and linted
    only. Recommend a follow-up ticket to add vitest, since `frontend/*/package.json`
    needs team coordination.
  - Nothing committed.

## Stage 3 done when

- [ ] Backend suite green (38 known errors only)
- [ ] `npm run type-check` and `npm run lint` clean in `frontend/receiver`
- [ ] A receiver with no ID can still confirm a delivery
- [ ] A vendor outage still lets a delivery be confirmed
- [ ] Nothing committed
