'use client'

import { Suspense, type JSX } from 'react'
import { useSearchParams } from 'next/navigation'
import { ParcelSearch } from '@/components/parcels/ParcelSearch'
import { TopBar } from '@/components/ui/TopBar'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/hooks/useAuth'

function SearchRoute(): JSX.Element {
  const params = useSearchParams()
  const { user } = useAuth()
  const barcode = params.get('barcode') ?? ''
  const waybill = params.get('waybill') ?? ''
  // A changed query or account withdraws the previous evidence before rendering a new request.
  return <ParcelSearch key={`${user?.id}:${user?.organization_id}:${barcode}:${waybill}`} initialBarcode={barcode} initialWaybill={waybill} />
}

export default function ParcelSearchPage(): JSX.Element {
  return <div className="flex min-h-0 flex-1 flex-col">
    <TopBar title="Parcel Search" sub="Barcode to consignment journey" />
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <Suspense fallback={<div role="status" aria-label="Loading parcel search" className="flex justify-center p-12"><Spinner size="lg" /></div>}><SearchRoute /></Suspense>
    </div>
  </div>
}
