'use client'

import { useParams } from 'next/navigation'
import { BlockchainBadge } from '@shared/components/blockchain/BlockchainBadge'
import { EventTimeline } from '@shared/components/blockchain/EventTimeline'
import { useVehicleDetail } from '@/lib/hooks/useVehicleDetail'

export default function VehicleDetailPage() {
  const params = useParams<{ id: string }>()
  const { data: vehicle, isLoading, error } = useVehicleDetail(params.id)

  if (isLoading) return <div className="p-6 text-white/60">Loading vehicle…</div>
  if (error || !vehicle) return <div className="p-6 text-red-300">Could not load vehicle.</div>

  const latestReceipt = vehicle.receipts[0] ?? null

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{vehicle.registration}</h1>
          <p className="text-sm text-white/60">
            {vehicle.vehicle_type === 'horse' ? 'Horse' : 'Trailer'}
            {vehicle.make ? ` · ${vehicle.make}` : ''}
            {vehicle.model ? ` ${vehicle.model}` : ''}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
          </p>
        </div>
        <BlockchainBadge receipt={latestReceipt} />
      </header>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-white/50">Pulsit device</dt>
          <dd className="text-white">{vehicle.pulsit_device_id}</dd>
          <dt className="text-white/50">VIN</dt>
          <dd className="text-white">{vehicle.vin_number ?? '—'}</dd>
          <dt className="text-white/50">Licence disc expiry</dt>
          <dd className="text-white">{vehicle.licence_disc_expiry ?? '—'}</dd>
          <dt className="text-white/50">Active</dt>
          <dd className="text-white">{vehicle.is_active ? 'Yes' : 'No'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Immutable history</h2>
        <EventTimeline events={vehicle.events} receipts={vehicle.receipts} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Trips using this vehicle</h2>
        {vehicle.trip_ids.length === 0 ? (
          <div className="text-sm text-white/40">No trips yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {vehicle.trip_ids.map((tid) => (
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
