'use client'

import { useParams } from 'next/navigation'
import { BlockchainBadge } from '@shared/components/blockchain/BlockchainBadge'
import { EventTimeline } from '@shared/components/blockchain/EventTimeline'
import { useDriverDetail } from '@/lib/hooks/useDriverDetail'

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>()
  const { data: driver, isLoading, error } = useDriverDetail(params.id)

  if (isLoading) return <div className="p-6 text-white/60">Loading driver…</div>
  if (error || !driver) return <div className="p-6 text-red-300">Could not load driver.</div>

  const latestReceipt = driver.receipts[0] ?? null

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{driver.full_name}</h1>
          <p className="text-sm text-white/60">{driver.phone_number}</p>
        </div>
        <BlockchainBadge receipt={latestReceipt} />
      </header>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-white/50">ID number</dt>
          <dd className="text-white">{driver.id_number}</dd>
          <dt className="text-white/50">Licence number</dt>
          <dd className="text-white">{driver.license_number}</dd>
          <dt className="text-white/50">Licence expiry</dt>
          <dd className="text-white">{driver.license_expiry ?? '—'}</dd>
          <dt className="text-white/50">IDVS</dt>
          <dd className="text-white">{driver.idvs_status}</dd>
          <dt className="text-white/50">Active</dt>
          <dd className="text-white">{driver.is_active ? 'Yes' : 'No'}</dd>
        </dl>
        <p className="mt-3 text-xs text-white/40">
          Driver personal info is stored in the database only and is never written to Hedera (POPIA).
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Immutable history</h2>
        <EventTimeline events={driver.events} receipts={driver.receipts} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Trips for this driver</h2>
        {driver.trip_ids.length === 0 ? (
          <div className="text-sm text-white/40">No trips yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {driver.trip_ids.map((tid) => (
              <li key={tid}>
                <a href={`/trips/${tid}`} className="text-emerald-300 hover:underline">
                  {tid}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
