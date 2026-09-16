// Stand-in for Didit's hosted verification flow, so the whole handover can be walked
// without a vendor account. With IDVS_USE_MOCK=false this route is never reached.
//
// Deliberately does NOT fake a document scan or face capture — the only thing this page
// needs to reproduce is what our own code depends on: the receiver leaves and comes back.
//
// The return path comes from sessionStorage, not the URL: the backend mock builds
// session_url from a session id alone with no capability token to put in it, so the
// handover page stashes where to come back to before it leaves.
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

// No-op: the stash never changes for the lifetime of this page, so there's nothing to
// subscribe to — useSyncExternalStore is used purely for its snapshot semantics.
function subscribeToNothing(): () => void {
  return () => {}
}

export default function MockIdvsPage() {
  // useSyncExternalStore avoids a hydration mismatch: a plain useState initializer would
  // read sessionStorage during prerender (null, since it doesn't exist at build time) but
  // the real value on the client's first render.
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
        <p className="text-center text-xs text-neutral-500">
          Only the approved path is walkable here. Declines are covered by the backend tests.
        </p>
      </div>
    </main>
  )
}
