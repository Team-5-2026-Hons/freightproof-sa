'use client'

import { useState, type FormEvent, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { InfoPopover } from '@/components/analytics/fleet/InfoPopover'
import { ROUTES } from '@/lib/constants/routes'
import { BARCODE_MAX_LENGTH } from './trace-display'
import { ParcelSearchResults, parcelSearchUrl } from './ParcelSearchResults'

const PAGE_TITLE = 'Find a parcel'
const HELP = {
  question: 'What parcel search shows',
  basis: 'Search an exact barcode to see what is recorded, where the consignment travelled, and which evidence supports the journey.',
  note: 'Leading zeros and letter case are preserved. Results belong to your organisation.',
}

interface Props { initialBarcode: string; initialWaybill: string }

export function ParcelSearch({ initialBarcode, initialWaybill }: Props): JSX.Element {
  const router = useRouter()
  const [input, setInput] = useState(initialBarcode)
  const [validation, setValidation] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [inPage, setInPage] = useState(false)
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

  const searched = initialBarcode !== ''
  return <div className="mx-auto w-full max-w-6xl space-y-5">
    <section className="rounded-xl bg-surf-lowest p-5 shadow-level-3 sm:p-6">
      <div className="mb-4 flex items-center gap-1.5">
        <h1 className="text-lg font-extrabold text-on-surf">{PAGE_TITLE}</h1>
        <InfoPopover title={PAGE_TITLE} ariaLabel="About parcel search" question={HELP.question} basis={HELP.basis} note={HELP.note} />
      </div>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 basis-64 flex-col gap-2 text-xs font-semibold text-on-surf-v" htmlFor="parcel-barcode">Parcel barcode
          <input id="parcel-barcode" name="barcode" type="text" value={input} maxLength={BARCODE_MAX_LENGTH} autoComplete="off" autoCapitalize="none" spellCheck={false}
            aria-invalid={validation !== null} aria-describedby={validation ? 'barcode-error' : undefined}
            onChange={event => { setInput(event.target.value); setValidation(null) }}
            placeholder="Type or paste a barcode" className="w-full rounded-md border border-outline-v/50 bg-surf-low px-3 py-3 text-sm font-medium tabular-nums text-on-surf outline-none focus:border-sec focus:ring-2 focus:ring-sec/20" />
        </label>
        <Button type="submit" className="min-h-11" loading={searching} iconLeft={<Ic n="search" s={16} />}>Search parcel</Button>
        {(input || initialBarcode) && <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setInput(''); setValidation(null); router.replace(ROUTES.parcels) }}>Clear</Button>}
      </form>
      {validation && <p id="barcode-error" role="alert" className="mt-2 text-xs text-err">{validation}</p>}
      {initialBarcode && input.trim() !== initialBarcode && <p className="mt-2 break-all text-xs font-semibold tabular-nums text-on-surf">Showing results for {initialBarcode}</p>}
    </section>
    {searched && <ParcelSearchResults key={JSON.stringify([initialBarcode, initialWaybill, refresh])} barcode={initialBarcode} waybill={initialWaybill} moveFocus={inPage} onSelectWaybill={selectWaybill} onLoadingChange={setSearching} />}
  </div>
}
