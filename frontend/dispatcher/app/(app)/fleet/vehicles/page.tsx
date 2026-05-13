'use client'

import { Plus } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { useVehicles } from '@/lib/hooks/useVehicles'
import type { Column } from '@/components/ui/DataTable'
import type { Vehicle } from '@shared/lib/types/vehicle'

const columns: Column<Vehicle>[] = [
  {
    key: 'registration',
    label: 'Registration',
    sortable: true,
    render: (val) => (
      <span className="font-bold font-mono tracking-[0.05em] text-surface-on">{String(val)}</span>
    ),
  },
  {
    key: 'vehicle_type',
    label: 'Type',
    sortable: true,
    render: (val) => (
      <span className="capitalize text-surface-on-variant">{String(val)}</span>
    ),
  },
  {
    key: 'pulsit_device_id',
    label: 'Pulsit Device',
    render: (val) => (
      <span className="font-mono text-xs tracking-wider text-surface-on-variant">{String(val ?? '—')}</span>
    ),
  },
  {
    key: 'is_active',
    label: 'Status',
    sortable: true,
    render: (val) => (
      <Chip type={val ? 'complete' : 'pending'} label={val ? 'Active' : 'Inactive'} />
    ),
  },
]

export default function FleetVehiclesPage() {
  const { all: vehicles } = useVehicles()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Fleet — Vehicles">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />}>
          Add Vehicle
        </Button>
      </TopBar>
      <div className="flex-1 overflow-y-auto p-6">
        <DataTable<Vehicle>
          columns={columns}
          rows={vehicles}
          empty={{ title: 'No vehicles', body: 'No vehicles registered yet.' }}
        />
      </div>
    </div>
  )
}
