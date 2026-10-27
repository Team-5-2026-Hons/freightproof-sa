'use client'

import { useEffect, useRef, type JSX } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { Skeleton } from '@/components/ui/Skeleton'
import { ROUTES } from '@/lib/constants/routes'
import { useParcelTrace } from '@/lib/hooks/useParcelTrace'
import { ParcelOverview } from './ParcelOverview'

interface Props {
  barcode: string
  waybill: string
  moveFocus: boolean
  onSelectWaybill: (waybill: string) => void
  /** Lets the search form's button show the lookup in progress; the form lives in the parent. */
  onLoadingChange: (loading: boolean) => void
}

type Outcome = 'success' | 'ambiguous' | 'no-match' | 'error'

export function parcelSearchUrl(barcode: string, waybill?: string): string {
  const params = new URLSearchParams({ barcode })
  if (waybill) params.set('waybill', waybill)
  return `${ROUTES.parcels}?${params}`
}

/**
 * Results for exactly one submitted query. The parent keys this component by query and
 * refresh counter, so a new query unmounts the hook (invalidating any in-flight response)
 * and old evidence is gone before the new request renders — without touching the form.
 */
export function ParcelSearchResults({ barcode, waybill, moveFocus, onSelectWaybill, onLoadingChange }: Props): JSX.Element {
  const { lookup, trace, busy, error, search, moreMatches, moreJourneys } = useParcelTrace()
  const focusPending = useRef(moveFocus)
  const summaryRef = useRef<HTMLHeadingElement>(null)
  const chooserRef = useRef<HTMLHeadingElement>(null)
  const noMatchRef = useRef<HTMLElement>(null)
  const errorRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { void search(barcode, waybill || undefined) }, [barcode, waybill, search])

  const loading = busy === 'lookup' || busy === 'trace'
  useEffect(() => {
    onLoadingChange(loading)
    return () => onLoadingChange(false)
  }, [loading, onLoadingChange])

  const outcome: Outcome | null = loading ? null
    : error ? 'error'
    : trace ? 'success'
    : lookup ? (lookup.items.length === 0 ? 'no-match' : 'ambiguous')
    : null

  useEffect(() => {
    if (!outcome || !focusPending.current) return
    const target = outcome === 'success' ? summaryRef.current
      : outcome === 'ambiguous' ? chooserRef.current
      : outcome === 'no-match' ? noMatchRef.current
      : errorRef.current
    if (!target) return
    target.focus()
    focusPending.current = false
  }, [outcome])

  function retry(): void {
    focusPending.current = true
    void search(barcode, waybill || undefined)
  }

  const announcement = loading ? 'Loading parcel evidence'
    : outcome === 'success' && trace ? `Parcel evidence loaded for ${trace.barcode}`
    : outcome === 'ambiguous' ? 'Several waybills match this barcode. Choose one.'
    : outcome === 'no-match' ? 'No matching parcel found'
    : ''
  const returnTo = trace ? parcelSearchUrl(trace.barcode, trace.waybill_reference) : ROUTES.parcels
  return <div aria-busy={loading} className="space-y-5">
    <p role="status" className="sr-only">{announcement}</p>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-err-c p-4 text-sm text-err-onc">
      <div><h2 ref={errorRef} tabIndex={-1} className="font-bold">Parcel evidence not loaded</h2><p className="mt-1">{error}</p></div>
      <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
    </div>}
    {lookup && (lookup.items.length > 1 || lookup.next_after) && <section aria-label="Matching waybills" className="rounded-xl bg-surf-lowest p-5 shadow-level-3">
      <h2 ref={chooserRef} tabIndex={-1} className="text-sm font-bold text-on-surf">Choose a matching waybill</h2>
      <p className="mt-1 text-xs text-on-surf-v">A barcode can occur in more than one consignment. Select the journey context you need.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">{lookup.items.map(match => <li key={match.waybill_reference}>
        <button type="button" aria-pressed={trace?.waybill_reference === match.waybill_reference} disabled={!!busy}
          onClick={() => onSelectWaybill(match.waybill_reference)}
          className="w-full rounded-lg border border-outline-v/40 p-3 text-left transition-colors hover:bg-surf-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec disabled:opacity-50 aria-pressed:border-sec aria-pressed:bg-sec-c/30">
          <span className="block break-all text-sm font-semibold tabular-nums text-sec">{match.waybill_reference}</span>
          <span className="mt-1 block text-xs text-on-surf-v">{match.journey_count} recorded {match.journey_count === 1 ? 'journey' : 'journeys'}</span>
        </button>
      </li>)}</ul>
      {lookup.next_after && <Button variant="ghost" size="sm" className="mt-3" loading={busy === 'more-matches'} disabled={!!busy} onClick={() => void moreMatches()}>More matching waybills</Button>}
    </section>}
    {loading && <div aria-hidden="true" className="space-y-4 rounded-xl bg-surf-lowest p-6 shadow-level-3"><Skeleton className="h-6 w-64" /><Skeleton className="h-16 w-full" /><Skeleton className="h-32 w-full" /></div>}
    {outcome === 'no-match' && <section ref={noMatchRef} tabIndex={-1} aria-label="No matching parcel" className="outline-none">
      <EmptyState icon={<Ic n="search" s={32} />} title="No matching parcel" body="No recorded journey visible to your organisation matches this exact barcode. Check the label and try again." />
    </section>}
    {trace && <div className="space-y-5">
      <ParcelOverview trace={trace} returnTo={returnTo} headingRef={summaryRef} loadingMore={busy === 'more-journeys'} onLoadMore={() => void moreJourneys()} />
    </div>}
  </div>
}
