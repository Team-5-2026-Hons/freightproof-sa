'use client'

// Route-level "no such page" screen (Next.js App Router convention file): rendered for any
// URL no route matches. With output: 'export' it is emitted as 404.html, which is what a
// static host and the Capacitor WebView serve for an unknown path — without this file that
// was Next's unstyled default, with no way out of it. Styled and laid out like app/error.tsx
// so a dead link looks like the rest of the app's recovery screens.

import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/lib/constants/routes'

export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      {/* A neutral card, not error.tsx's red one: nothing crashed, the address is just wrong. */}
      <div className="flex w-full flex-col items-center gap-3 rounded-xl bg-surface-container-low px-6 py-8 text-center text-surface-on">
        <SearchX className="h-10 w-10 text-surface-on-variant" strokeWidth={1.5} aria-hidden />
        <h1 className="text-lg font-bold">Page not found</h1>
        <p className="text-sm text-surface-on-variant">
          We couldn&rsquo;t find that page. It may have moved, or the link may be out of date.
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        {/* Plain anchor (full page load), as on error.tsx: this page can be served for any
            path, and a hard load of Home is the reliable way back from an unknown one. */}
        <Button asChild size="lg">
          <a href={ROUTES.home}>Go to Home</a>
        </Button>
      </div>
    </main>
  )
}
