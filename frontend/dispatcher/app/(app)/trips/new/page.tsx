'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/hooks/useToast'
import { ROUTES } from '@/lib/constants/routes'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { COPY } from '@shared/lib/constants/copy'
import { cn } from '@shared/lib/utils/cn'

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
    <PageShell>
      <PageHeader
        title="Create New Trip"
        breadcrumbs={[
          { label: 'Active Trips', href: ROUTES.home },
        ]}
        actions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<ArrowLeft className="w-4 h-4" />}
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Order Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-surface-on border-b border-outline-variant/20 pb-2">Order Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Order Number"
                placeholder="e.g. FX-ORD-2026-..."
                value={orderNumber}
                onChange={e => { setOrderNumber(e.target.value); setError(false) }}
                error={error && !orderNumber ? 'Required' : undefined}
              />
              <Input
                label="Planned Departure"
                type="datetime-local"
                value={plannedDeparture}
                onChange={e => { setPlannedDeparture(e.target.value); setError(false) }}
                error={error && !plannedDeparture ? 'Required' : undefined}
              />
            </div>
          </div>

          {/* Route */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-surface-on border-b border-outline-variant/20 pb-2">Route</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">
                  Origin Precinct
                </label>
                <select
                  value={originId}
                  onChange={e => { setOriginId(e.target.value); setError(false) }}
                  className={cn(
                    'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
                    'bg-surface-container-low border border-outline-variant/30',
                    'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
                    'transition-colors duration-150 min-h-[44px] appearance-none',
                    error && !originId && 'border-error focus:border-error'
                  )}
                >
                  <option value="">Select Origin...</option>
                  {precincts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {error && !originId && <p className="text-xs text-error font-medium">Required</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">
                  Destination Precinct
                </label>
                <select
                  value={destId}
                  onChange={e => { setDestId(e.target.value); setError(false) }}
                  className={cn(
                    'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
                    'bg-surface-container-low border border-outline-variant/30',
                    'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
                    'transition-colors duration-150 min-h-[44px] appearance-none',
                    error && !destId && 'border-error focus:border-error'
                  )}
                >
                  <option value="">Select Destination...</option>
                  {precincts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {error && !destId && <p className="text-xs text-error font-medium">Required</p>}
              </div>
            </div>
          </div>

          {/* Resources */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-surface-on border-b border-outline-variant/20 pb-2">Resources</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">
                  Driver
                </label>
                <select
                  value={driverId}
                  onChange={e => { setDriverId(e.target.value); setError(false) }}
                  className={cn(
                    'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
                    'bg-surface-container-low border border-outline-variant/30',
                    'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
                    'transition-colors duration-150 min-h-[44px] appearance-none',
                    error && !driverId && 'border-error focus:border-error'
                  )}
                >
                  <option value="">Select Driver...</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.full_name}</option>
                  ))}
                </select>
                {error && !driverId && <p className="text-xs text-error font-medium">Required</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">
                  Horse
                </label>
                <select
                  value={horseId}
                  onChange={e => { setHorseId(e.target.value); setError(false) }}
                  className={cn(
                    'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
                    'bg-surface-container-low border border-outline-variant/30',
                    'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
                    'transition-colors duration-150 min-h-[44px] appearance-none',
                    error && !horseId && 'border-error focus:border-error'
                  )}
                >
                  <option value="">Select Horse...</option>
                  {horses.map(h => (
                    <option key={h.id} value={h.id}>{h.registration}</option>
                  ))}
                </select>
                {error && !horseId && <p className="text-xs text-error font-medium">Required</p>}
              </div>
            </div>
            
            {/* Multiple trailers selection via multi-select for MVP */}
             <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-surface-on-variant">
                  Trailers (Optional)
                </label>
                <select
                  multiple
                  value={trailerIds}
                  onChange={e => {
                    const values = Array.from(e.target.selectedOptions, option => option.value)
                    setTrailerIds(values)
                  }}
                  className={cn(
                    'w-full rounded-xl px-4 py-3 text-sm font-medium text-surface-on',
                    'bg-surface-container-low border border-outline-variant/30',
                    'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
                    'transition-colors duration-150 min-h-[88px]',
                  )}
                >
                  {trailers.map(t => (
                    <option key={t.id} value={t.id}>{t.registration}</option>
                  ))}
                </select>
                <p className="text-xs text-surface-on-variant">Hold Cmd/Ctrl to select multiple</p>
              </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
            >
              Create Trip
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
