// frontend/receiver/app/mock-idvs/[sessionId]/page.tsx
//
// Stand-in for Didit's hosted verification flow, so the whole handover can be walked on a
// laptop with no vendor account. MockIdvsClient.create_session points session_url here;
// with IDVS_USE_MOCK=false this route is never reached.
//
// It deliberately does NOT fake a document scan or a face capture. Pretending to do
// biometrics would make a demo look like it proves something it does not — the real flow
// happens on the vendor's domain, and the only thing this page needs to reproduce is the
// part our own code depends on: the receiver leaves, time passes, the receiver comes back.
//
// The return path comes from sessionStorage rather than the URL. The backend mock builds
// session_url from a session id alone and has no capability token to put in it — see
// integrations/idvs.py — so the handover page stashes where to come back to before it
// leaves. Same store, same tab, same origin.
'use client'

import { useSyncExternalStore } from 'react'

const IDENTITY_STASH_KEY = 'fp_handover_identity'

interface StashedIdentity {
  name: string
  idNumber: string
  token?: string
}

function readStash(): StashedIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_STASH_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Partial<StashedIdentity>).name === 'string'
    ) {
      return parsed as StashedIdentity
    }
    return null
  } catch {
    return null
  }
}

// No-op: the stash is read once and never changes for the lifetime of this page, so there
// is nothing to subscribe to. useSyncExternalStore is used purely for its snapshot
// semantics, not its reactivity.
function subscribeToNothing(): () => void {
  return () => {}
}

export default function MockIdvsPage() {
  // Reading sessionStorage directly in an effect (the earlier version of this) is
  // synchronous setState-in-effect, and a plain lazy useState initializer would read it
  // during the server/build prerender pass too (returning null there) but then read the
  // real value on the client's first hydration render, mismatching the prerendered HTML.
  // useSyncExternalStore is the pattern this is for: a fixed server snapshot (null, since
  // sessionStorage does not exist at build time) versus a real client-only snapshot,
  // reconciled by React without a hydration mismatch.
  const returnToken = useSyncExternalStore(
    subscribeToNothing,
    () => readStash()?.token ?? null,
    () => null,
  )

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
          Simulated · not a real identity check
        </p>
        <h1 className="text-xl font-medium text-neutral-900">Identity verification</h1>
        <p className="text-sm text-neutral-600">
          This stands in for the verification provider while
          <code className="mx-1 rounded bg-neutral-100 px-1">IDVS_USE_MOCK</code>
          is true. Nothing is photographed and nothing is checked.
        </p>
      </header>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        <p className="font-medium text-neutral-900">On the real provider you would:</p>
        <ul className="mt-2 flex flex-col gap-1">
          <li>• Photograph your identity document</li>
          <li>• Take a photograph of your face</li>
          <li>• Wait a few seconds for the result</li>
        </ul>
      </div>

      <div className="mt-auto flex flex-col gap-2 pb-6">
        {returnToken === null ? (
          <p className="text-sm text-red-600">
            No handover to return to. Open this from a delivery link rather than directly.
          </p>
        ) : (
          <a
            className="rounded-lg bg-neutral-900 px-4 py-3.5 text-center text-base font-medium text-white"
            href={`/h/${returnToken}`}
          >
            Finish and return to the delivery
          </a>
        )}
        {/* A declined outcome needs the decision staged server-side via
            MockIdvsClient.stage_decision, which has no dev endpoint yet — the same seam
            FP-197 built for staging Pulsit positions. The decline path is covered by the
            backend tests; it is not walkable here. */}
        <p className="text-center text-xs text-neutral-500">
          Only the approved path is walkable here. Declines are covered by the backend tests.
        </p>
      </div>
    </main>
  )
}
