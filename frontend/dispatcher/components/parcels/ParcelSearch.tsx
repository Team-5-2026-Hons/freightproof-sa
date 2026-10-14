'use client'

import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { Skeleton } from '@/components/ui/Skeleton'
import { ROUTES } from '@/lib/constants/routes'
import { useParcelTrace } from '@/lib/hooks/useParcelTrace'
import { BARCODE_MAX_LENGTH } from './trace-display'
import { ParcelCurrentState, ParcelJourneyView } from './ParcelJourneyView'

interface Props { initialBarcode: string; initialWaybill: string }

function searchUrl(barcode: string, waybill?: string): string {
  const params = new URLSearchParams({ barcode })
  if (waybill) params.set('waybill', waybill)
  return `${ROUTES.parcels}?${params}`
}

export function ParcelSearch({ initialBarcode, initialWaybill }: Props): JSX.Element {
  const router = useRouter()
  const [input, setInput] = useState(initialBarcode)
  const [validation, setValidation] = useState<string | null>(null)
  const { lookup, trace, busy, error, clear, search, moreMatches, moreJourneys } = useParcelTrace()

  useEffect(() => {
    if (initialBarcode) void search(initialBarcode, initialWaybill || undefined)
  }, [initialBarcode, initialWaybill, search])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const barcode = input.trim()
    if (!barcode || barcode.length > BARCODE_MAX_LENGTH) {
      clear(); setValidation(`Enter a barcode of 1–${BARCODE_MAX_LENGTH} characters.`)
      return
    }
    setValidation(null)
    if (barcode === initialBarcode && !initialWaybill) void search(barcode)
    else router.replace(searchUrl(barcode), { scroll: false })
  }

  const returnTo = trace ? searchUrl(trace.barcode, trace.waybill_reference) : ROUTES.parcels
  const initialLoading = busy === 'lookup' || busy === 'trace'
  return <div className="mx-auto w-full max-w-6xl space-y-5">
    <section className="rounded-xl bg-surf-lowest p-5 shadow-level-3 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-lg bg-surf-low p-3 text-sec"><Ic n="box" s={21} /></span>
        <div><h1 className="text-lg font-extrabold text-on-surf">Find a parcel. Follow the evidence.</h1><p className="mt-1 text-sm text-on-surf-v">Search an exact barcode to see its recorded state and consignment journey.</p></div>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 basis-64 flex-col gap-2 text-xs font-semibold text-on-surf-v" htmlFor="parcel-barcode">Parcel barcode
          <input id="parcel-barcode" name="barcode" type="text" value={input} maxLength={BARCODE_MAX_LENGTH} autoComplete="off" autoCapitalize="none" spellCheck={false}
            aria-invalid={validation !== null} aria-describedby={validation ? 'barcode-error' : 'barcode-help'}
            onChange={event => { setInput(event.target.value); setValidation(null); clear() }}
            placeholder="Type or paste a barcode" className="w-full rounded-md border border-outline-v/50 bg-surf-low px-3 py-3 text-sm font-medium tabular-nums text-on-surf outline-none focus:border-sec focus:ring-2 focus:ring-sec/20" />
        </label>
        <Button type="submit" loading={busy === 'lookup'} iconLeft={<Ic n="search" s={16} />}>Search parcel</Button>
        {(input || lookup) && <Button type="button" variant="ghost" onClick={() => { clear(); setInput(''); setValidation(null); router.replace(ROUTES.parcels) }}>Clear</Button>}
      </form>
      {validation ? <p id="barcode-error" role="alert" className="mt-2 text-xs text-err">{validation}</p> : <p id="barcode-help" className="mt-2 text-xs text-on-surf-v">Leading zeros and letter case are preserved. Results belong to your organisation.</p>}
    </section>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-err-c p-4 text-sm text-err-onc"><p>{error}</p><Button variant="secondary" size="sm" onClick={() => void search(initialBarcode || input.trim(), initialWaybill || undefined)}>Try again</Button></div>}
    {lookup && (lookup.items.length > 1 || lookup.next_after) && <section aria-label="Matching waybills" className="rounded-xl bg-surf-lowest p-5 shadow-level-3">
      <h2 className="text-sm font-bold text-on-surf">Choose a matching waybill</h2>
      <p className="mt-1 text-xs text-on-surf-v">A barcode can occur in more than one consignment. Select the journey context you need.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">{lookup.items.map(match => <li key={match.waybill_reference}>
        <button type="button" aria-pressed={trace?.waybill_reference === match.waybill_reference} disabled={!!busy}
          onClick={() => router.replace(searchUrl(lookup.barcode, match.waybill_reference), { scroll: false })}
          className="w-full rounded-lg border border-outline-v/40 p-3 text-left transition-colors hover:bg-surf-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec disabled:opacity-50 aria-pressed:border-sec aria-pressed:bg-sec-c/30">
          <span className="block break-all text-sm font-semibold tabular-nums text-sec">{match.waybill_reference}</span>
          <span className="mt-1 block text-xs text-on-surf-v">{match.journey_count} recorded {match.journey_count === 1 ? 'journey' : 'journeys'}</span>
        </button>
      </li>)}</ul>
      {lookup.next_after && <Button variant="ghost" size="sm" className="mt-3" loading={busy === 'more-matches'} disabled={!!busy} onClick={() => void moreMatches()}>More matching waybills</Button>}
    </section>}
    {initialLoading && <div role="status" aria-label="Loading parcel evidence" className="space-y-4 rounded-xl bg-surf-lowest p-6 shadow-level-3"><Skeleton className="h-6 w-64" /><Skeleton className="h-16 w-full" /><Skeleton className="h-32 w-full" /><span className="sr-only">Loading parcel evidence</span></div>}
    <div aria-live="polite" aria-busy={initialLoading} className="space-y-5">
      {!busy && lookup?.items.length === 0 && !trace && !error && <EmptyState icon={<Ic n="search" s={32} />} title="No matching parcel" body="No recorded journey visible to your organisation matches this exact barcode. Check the label and try again." />}
      {!lookup && !busy && !error && <EmptyState icon={<Ic n="box" s={32} />} title="Start with a barcode" body="See what is recorded, where the consignment travelled, and which evidence supports the journey." />}
      {trace && <>
        <ParcelCurrentState trace={trace} />
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-on-surf-v" aria-label="Evidence legend">
          <span className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 border border-outline" />Parcel scan observation</span>
          <span className="flex items-center gap-2"><Ic n="truck" s={15} />Inherited consignment evidence</span>
          <span className="flex items-center gap-2"><Ic n="warn" s={15} className="text-warn" />Missing or disputed evidence</span>
        </div>
        {trace.journeys.map(journey => <ParcelJourneyView key={journey.trip_id} journey={journey} returnTo={returnTo} />)}
        {trace.next_cursor && <Button variant="secondary" loading={busy === 'more-journeys'} disabled={!!busy} onClick={() => void moreJourneys()}>Load earlier journeys</Button>}
        <p className="rounded-lg bg-surf-low p-4 text-xs leading-relaxed text-on-surf-v">{trace.coverage_note}</p>
      </>}
    </div>
  </div>
}
