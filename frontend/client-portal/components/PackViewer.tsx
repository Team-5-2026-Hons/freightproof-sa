'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { PackError, fetchPack, pdfUrl } from '@/lib/api'
import { formatSast, humanise } from '@/lib/format'
import { buildTimeline } from '@/lib/timeline'
import type { PublicAuditPackView } from '@/lib/types'
import { Card } from './Card'
import { EventDetail } from './EventDetail'
import { PdfCheck } from './PdfCheck'
import { Cargo, Coverage, DataProtection, Exceptions, Incident, Integrity, Observations, Parties, TierLegend } from './Sections'
import { Timeline } from './Timeline'
import { VerificationPanel } from './VerificationPanel'

// Leaflet reads `window` at import, so the map only ever renders in the browser.
const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-md bg-surf-low sm:h-[460px]" />,
})

type Load = { state: 'loading' } | { state: 'ready'; view: PublicAuditPackView } | { state: 'error'; status: number; message: string }

export function PackViewer({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchPack(token)
      .then((view) => !cancelled && setLoad({ state: 'ready', view }))
      .catch((err: unknown) => {
        if (cancelled) return
        const status = err instanceof PackError ? err.status : 0
        const message = err instanceof PackError ? err.message : 'The audit pack could not be loaded. Check your connection and try again.'
        setLoad({ state: 'error', status, message })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const items = useMemo(() => (load.state === 'ready' ? buildTimeline(load.view.manifest) : []), [load])
  const selected = items.find((i) => i.id === selectedId) ?? null

  if (load.state === 'loading') {
    return <p className="px-4 py-24 text-center text-sm text-muted">Opening audit pack…</p>
  }
  if (load.state === 'error') {
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-xl font-extrabold">{load.status === 410 ? 'This link is no longer active' : 'Audit pack unavailable'}</h1>
        <p className="mt-2 text-sm text-muted">{load.message}</p>
      </main>
    )
  }

  const { view } = load
  const { manifest, seal } = view
  function select(id: string) {
    setSelectedId(id)
    document.getElementById('evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
            <a href={pdfUrl(token)} className="no-print rounded-md border border-white/20 bg-gradient-to-br from-ink to-ink-soft px-4 py-2 text-[13px] font-semibold hover:border-white/40">
              Download PDF
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-8">
        <VerificationPanel token={token} seal={seal} records={manifest.anchored_records} />
        <Observations manifest={manifest} />
        <Incident token={token} manifest={manifest} onSelect={select} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Card title="Timeline" id="timeline">
            <Timeline items={items} selectedId={selectedId} onSelect={select} />
          </Card>
          <div className="min-w-0 space-y-4">
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
        <Card title="How to read this pack" id="legend"><TierLegend /></Card>
        <Integrity manifest={manifest} seal={seal} />
        <Card title="Check a copy of the PDF" id="pdf-check"><PdfCheck seal={seal} /></Card>
        <DataProtection manifest={manifest} />
      </main>
    </div>
  )
}
