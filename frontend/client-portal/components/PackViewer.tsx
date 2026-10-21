'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { PackError, STORAGE_BLOCKED_NOTICE, fetchPack, storageBlocked } from '@/lib/api'
import { formatSast, humanise } from '@/lib/format'
import { mediaMatches, prefersReducedMotion } from '@/lib/media'
import { buildTimeline } from '@/lib/timeline'
import type { PublicAuditPackView } from '@/lib/types'
import type { AnchorCheckResult } from '@/lib/verify'
import { Card } from './Card'
import { DownloadButton } from './DownloadButton'
import { EmailCodeGate } from './EmailCodeGate'
import { EventDetail } from './EventDetail'
import { PdfCheck } from './PdfCheck'
import { Cargo, Coverage, DataProtection, Exceptions, Incident, Integrity, NotShownHere, Observations, Parties, TierLegend } from './Sections'
import { Timeline } from './Timeline'
import { VerificationPanel } from './VerificationPanel'

// Leaflet reads `window` at import, so the map only ever renders in the browser.
const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-md bg-surf-low sm:h-[460px]" />,
})

// Below the `lg` breakpoint the Evidence card is stacked under the timeline and off-screen after a
// pick; from `lg` up it sits beside the timeline and is already in view.
const STACKED_LAYOUT_QUERY = '(max-width: 1023px)'
// A failed load worth offering again: the network dropped, the server hiccupped, or we were rate limited.
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500

type Load =
  | { state: 'loading' }
  | { state: 'ready'; view: PublicAuditPackView }
  | { state: 'needs-code'; emailHint: string }
  | { state: 'error'; status: number; message: string }

export function PackViewer({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Bumped after the emailed code is accepted, so the pack is fetched again with the grant.
  const [attempt, setAttempt] = useState(0)
  // The browser's own check of the pack seal, reported by the verification panel, so the PDF
  // check can say whether the fingerprint it matches was itself confirmed on Hedera.
  const [sealCheck, setSealCheck] = useState<AnchorCheckResult | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchPack(token)
      .then((view) => !cancelled && setLoad({ state: 'ready', view }))
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof PackError && err.verificationRequired) {
          setLoad({ state: 'needs-code', emailHint: err.emailHint ?? '' })
          return
        }
        console.warn('Could not load the audit pack', err)
        const status = err instanceof PackError ? err.status : 0
        const message = err instanceof PackError ? err.message : 'The audit pack could not be loaded. Check your connection and try again.'
        setLoad({ state: 'error', status, message })
      })
    return () => {
      cancelled = true
    }
  }, [token, attempt])

  const items = useMemo(() => (load.state === 'ready' ? buildTimeline(load.view.manifest) : []), [load])
  const selected = items.find((i) => i.id === selectedId) ?? null

  if (load.state === 'loading') {
    return <p className="px-4 py-24 text-center text-sm text-muted">Opening audit pack…</p>
  }
  if (load.state === 'needs-code') {
    return (
      <EmailCodeGate
        token={token}
        emailHint={load.emailHint}
        onVerified={() => {
          setLoad({ state: 'loading' })
          setAttempt((n) => n + 1)
        }}
      />
    )
  }
  if (load.state === 'error') {
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-xl font-extrabold">{load.status === 410 ? 'This link is no longer active' : 'Audit pack unavailable'}</h1>
        <p className="mt-2 text-sm text-muted">{load.message}</p>
        {(load.status === 0 || load.status === HTTP_TOO_MANY_REQUESTS || load.status >= HTTP_SERVER_ERROR) && (
          <button
            type="button"
            onClick={() => {
              setLoad({ state: 'loading' })
              setAttempt((n) => n + 1)
            }}
            className="mt-4 min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        )}
      </main>
    )
  }

  const { view } = load
  const { manifest, seal } = view
  function select(id: string) {
    setSelectedId(id)
    if (!mediaMatches(STACKED_LAYOUT_QUERY)) return
    document.getElementById('evidence')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div>
      <header className="bg-ink px-4 py-5 text-white sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/60">FreightProof audit pack · {humanise(view.purpose)}</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="num text-[22px] font-extrabold">{seal.pack_label}</h1>
              <p className="text-[13px] text-white/80">
                Trip {manifest.trip.trip_reference} · issued to {view.recipient_name}, {view.recipient_organization}
                {view.external_reference && ` · ref ${view.external_reference}`}
              </p>
              <p className="num text-[12px] text-white/60">Issued {formatSast(seal.issued_at)} · link valid until {formatSast(seal.expires_at)}</p>
            </div>
            <DownloadButton
              token={token}
              file="pdf"
              filename={`${seal.pack_label}.pdf`}
              className="min-h-11 rounded-md border border-white/20 bg-gradient-to-br from-ink to-ink-soft px-4 py-2 text-[13px] font-semibold hover:border-white/40 disabled:opacity-60"
            >
              Download PDF
            </DownloadButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-8">
        {storageBlocked() && <p className="no-print text-[12px] text-muted">{STORAGE_BLOCKED_NOTICE}</p>}
        <VerificationPanel token={token} seal={seal} records={manifest.anchored_records} onSealCheck={setSealCheck} />
        <Observations manifest={manifest} />
        <Incident token={token} manifest={manifest} onSelect={select} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Card title="Timeline" id="timeline">
            {/* Capped on wide screens so a long trip scrolls inside its card instead of stretching the page. */}
            <div className="lg:max-h-[70vh] lg:overflow-y-auto print:max-h-none print:overflow-visible">
              <Timeline items={items} selectedId={selectedId} onSelect={select} />
            </div>
          </Card>
          <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card title="Route" id="route">
              <RouteMap manifest={manifest} items={items} selectedId={selectedId} onSelect={select} />
            </Card>
            <Card title="Evidence" id="evidence">
              <EventDetail token={token} item={selected} />
            </Card>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Exceptions exceptions={manifest.exceptions} onSelect={select} />
          <Cargo manifest={manifest} />
          <Parties manifest={manifest} />
          <Coverage manifest={manifest} />
        </div>
        <NotShownHere manifest={manifest} />
        <Card title="How to read this pack" id="legend"><TierLegend /></Card>
        <Integrity manifest={manifest} seal={seal} />
        <Card title="Check a copy of the PDF" id="pdf-check"><PdfCheck seal={seal} sealCheck={sealCheck} /></Card>
        <DataProtection manifest={manifest} />
      </main>
    </div>
  )
}
