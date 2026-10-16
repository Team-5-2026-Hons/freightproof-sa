'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'
import { BARCODE_MAX_LENGTH } from './trace-display'
import { ParcelSearchResults, parcelSearchUrl } from './ParcelSearchResults'

interface Props { initialBarcode: string; initialWaybill: string }

export function ParcelSearch({ initialBarcode, initialWaybill }: Props): JSX.Element {
  const router = useRouter()
  const [input, setInput] = useState(initialBarcode)
  const [validation, setValidation] = useState<string | null>(null)
  // Bumping this remounts the results, which is how a same-query resubmit refetches.
  const [refresh, setRefresh] = useState(0)
  // Focus follows only in-page transitions; a deep-link first load keeps focus where the browser put it.
  const [inPage, setInPage] = useState(false)
  // The URL is the submitted query. When it changes (a push, or Back/Forward) the draft follows it,
  // adjusted during render so the textbox never shows a frame of the previous query.
  const [syncedQuery, setSyncedQuery] = useState([initialBarcode, initialWaybill])
  if (syncedQuery[0] !== initialBarcode || syncedQuery[1] !== initialWaybill) {
    setSyncedQuery([initialBarcode, initialWaybill])
    setInPage(true)
    setInput(initialBarcode)
    setValidation(null)
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const barcode = input.trim()
    if (!barcode || barcode.length > BARCODE_MAX_LENGTH) {
      setValidation(`Enter a barcode of 1–${BARCODE_MAX_LENGTH} characters.`)
      return
    }
    setValidation(null)
    if (barcode === initialBarcode && !initialWaybill) { setInPage(true); setRefresh(count => count + 1) }
    else router.push(parcelSearchUrl(barcode), { scroll: false })
  }

  function selectWaybill(waybill: string): void {
    if (waybill === initialWaybill) { setInPage(true); setRefresh(count => count + 1) }
    else router.push(parcelSearchUrl(initialBarcode, waybill), { scroll: false })
  }

  // The URL decides the layout: any submitted barcode compacts the form, Clear returns it to the centred start.
  const compact = initialBarcode !== ''
  return <div className="mx-auto w-full max-w-6xl space-y-5">
    <section className={cn('rounded-xl bg-surf-lowest p-5 shadow-level-3 sm:p-6', !compact && 'mx-auto mt-4 max-w-xl sm:mt-[8vh]')}>
      {compact
        ? <h1 className="sr-only">Find a parcel. Follow the evidence.</h1>
        : <div className="mb-5 flex items-start gap-3">
          <span className="rounded-lg bg-surf-low p-3 text-sec"><Ic n="box" s={21} /></span>
          <div><h1 className="text-lg font-extrabold text-on-surf">Find a parcel. Follow the evidence.</h1><p className="mt-1 text-sm text-on-surf-v">Search an exact barcode to see what is recorded, where the consignment travelled, and which evidence supports the journey.</p></div>
        </div>}
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 basis-64 flex-col gap-2 text-xs font-semibold text-on-surf-v" htmlFor="parcel-barcode">Parcel barcode
          <input id="parcel-barcode" name="barcode" type="text" value={input} maxLength={BARCODE_MAX_LENGTH} autoComplete="off" autoCapitalize="none" spellCheck={false}
            aria-invalid={validation !== null} aria-describedby={validation ? 'barcode-error' : 'barcode-help'}
            onChange={event => { setInput(event.target.value); setValidation(null) }}
            placeholder="Type or paste a barcode" className="w-full rounded-md border border-outline-v/50 bg-surf-low px-3 py-3 text-sm font-medium tabular-nums text-on-surf outline-none focus:border-sec focus:ring-2 focus:ring-sec/20" />
        </label>
        <Button type="submit" className="min-h-11" iconLeft={<Ic n="search" s={16} />}>Search parcel</Button>
        {(input || initialBarcode) && <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setInput(''); setValidation(null); router.replace(ROUTES.parcels) }}>Clear</Button>}
      </form>
      {validation ? <p id="barcode-error" role="alert" className="mt-2 text-xs text-err">{validation}</p> : <p id="barcode-help" className="mt-2 text-xs text-on-surf-v">Leading zeros and letter case are preserved. Results belong to your organisation.</p>}
      {initialBarcode && input.trim() !== initialBarcode && <p className="mt-2 break-all text-xs font-semibold tabular-nums text-on-surf">Showing results for {initialBarcode}</p>}
    </section>
    {compact && <ParcelSearchResults key={JSON.stringify([initialBarcode, initialWaybill, refresh])} barcode={initialBarcode} waybill={initialWaybill} moveFocus={inPage} onSelectWaybill={selectWaybill} />}
  </div>
}
