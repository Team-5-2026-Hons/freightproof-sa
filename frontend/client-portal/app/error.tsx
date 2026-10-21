'use client'

import { useEffect } from 'react'

// Rendered when something under a page throws while displaying a pack (a field of an unexpected
// shape, say). Without it the visitor gets Next's blank error page and no way back.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.warn('The pack view failed to render', error)
  }, [error])

  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-xl font-extrabold">Something went wrong displaying this pack</h1>
      <p className="mt-2 text-sm text-muted">The pack itself has not changed. Try again, or reload the page.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </main>
  )
}
