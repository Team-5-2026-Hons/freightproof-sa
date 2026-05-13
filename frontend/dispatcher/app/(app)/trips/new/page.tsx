'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar }   from '@/components/ui/TopBar'
import { SecHead }  from '@/components/ui/SecHead'
import { Ic }       from '@/components/ui/Ic'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { COPY } from '@shared/lib/constants/copy'

export default function TripNewPage() {
  const router = useRouter()
  const { notify } = useToast()
  
  const drivers = useDrivers()
  const { horses, trailers } = useVehicles()
  const precincts = usePrecincts()

  // Form state
  const [orderNumber, setOrderNumber] = useState('')
  const [driverId, setDriverId] = useState('')
  const [horseId, setHorseId] = useState('')
  const [trailerIds, setTrailerIds] = useState<string[]>([])
  const [originId, setOriginId] = useState('')
  const [destId, setDestId] = useState('')
  const [plannedDeparture, setPlannedDeparture] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // A very basic form validation: everything required except trailers
  const isValid = orderNumber && driverId && horseId && originId && destId && plannedDeparture

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!isValid) {
      setError(true)
      return
    }

    setLoading(true)
    
    // Simulate API latency
    await new Promise(r => setTimeout(r, 800))
    
    notify({
      kind: 'success',
      title: COPY.toast.tripCreated,
    })
    
    // Just mock route to home for now since we don't have real creation hooked up
    router.push(ROUTES.home)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="New Trip">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </TopBar>

      <div className="flex gap-6 p-6 flex-1 overflow-auto">
        {/* Form — left column */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4 min-w-0">
          {/* ORDER */}
          <Card className="p-6">
            <SecHead title="Order" />
            <div className="p-6 pt-3">
              <Input
                label="Order number"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                error={error && !orderNumber ? 'Required' : undefined}
              />
            </div>
          </Card>

          {/* DRIVER & VEHICLE */}
          <Card className="p-0 overflow-hidden">
            <SecHead title="Driver & Vehicle" />
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Driver</label>
                <select
                  value={driverId}
                  onChange={e => setDriverId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select driver…</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Horse (truck)</label>
                <select
                  value={horseId}
                  onChange={e => setHorseId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select horse…</option>
                  {horses.map(h => (
                    <option key={h.id} value={h.id}>{h.registration}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Trailer(s)</label>
                <select
                  multiple
                  value={trailerIds}
                  onChange={e => setTrailerIds(Array.from(e.target.selectedOptions, o => o.value))}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors h-24"
                >
                  {trailers.map(t => (
                    <option key={t.id} value={t.id}>{t.registration}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* ROUTE */}
          <Card className="p-0 overflow-hidden">
            <SecHead title="Route" />
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Origin precinct</label>
                <select
                  value={originId}
                  onChange={e => setOriginId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select origin…</option>
                  {precincts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-[600] text-on-surf-v mb-1">Destination precinct</label>
                <select
                  value={destId}
                  onChange={e => setDestId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] bg-surf-low border border-outline-v/30 rounded-md text-on-surf outline-none focus:border-sec transition-colors"
                >
                  <option value="">Select destination…</option>
                  {precincts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* SLOT TIME */}
          <Card className="p-0 overflow-hidden">
            <SecHead title="Schedule" />
            <div className="p-6">
              <Input
                label="Planned departure"
                type="datetime-local"
                value={plannedDeparture}
                onChange={e => setPlannedDeparture(e.target.value)}
              />
            </div>
          </Card>

          <Button
            type="submit"
            full
            loading={loading}
            disabled={!isValid}
          >
            Create Trip · Anchor journey lock
          </Button>
        </form>

        {/* Summary preview — right column */}
        <div className="w-[300px] shrink-0 hidden lg:block">
          <Card className="p-0 overflow-hidden sticky top-0">
            <SecHead title="Trip Summary" />
            <div className="p-5 flex flex-col gap-3 text-[13px]">
              {[
                { label: 'Order',       value: orderNumber  || '—' },
                { label: 'Driver',      value: drivers.find(d => d.id === driverId)?.full_name || '—' },
                { label: 'Horse',       value: horses.find(h => h.id === horseId)?.registration || '—' },
                { label: 'Origin',      value: precincts.find(p => p.id === originId)?.name || '—' },
                { label: 'Destination', value: precincts.find(p => p.id === destId)?.name || '—' },
              ].map(row => (
                <div key={row.label} className="flex justify-between gap-2">
                  <span className="text-on-surf-v font-[500]">{row.label}</span>
                  <span className="text-on-surf font-[600] text-right truncate max-w-[160px]">{row.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
