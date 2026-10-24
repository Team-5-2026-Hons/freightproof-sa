// Last-resort boundary for an unexpected render error, so a stranger sees a sentence and a
// way to retry instead of a blank page. It must be a Client Component, and it must not echo
// the error: the path of this page carries a live capability token.
'use client'

import { useEffect } from 'react'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Name and digest only — a message could quote the URL.
    console.warn('[receiver] unexpected render error:', error.name, error.digest)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-medium text-neutral-900">Something went wrong</h1>
      <p className="max-w-sm text-sm text-neutral-600">
        This page hit a problem it couldn&apos;t recover from. Trying again often fixes it.
      </p>
      <button
        type="button"
        className="mt-2 rounded-lg bg-neutral-900 px-6 py-3.5 text-base font-medium text-white"
        onClick={reset}
      >
        Try again
      </button>
    </main>
  )
}
