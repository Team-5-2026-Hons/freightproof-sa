'use client'

import { Truck, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { useVehicles } from '@/lib/hooks/useVehicles'
import type { Vehicle } from '@shared/lib/types/vehicle'

export default function FleetVehiclesPage() {
  const { all: vehicles } = useVehicles()

  const columns = [
    {
      key: 'registration',
      label: 'Registration',
      sortable: true,
      render: (val: any) => <span className="font-bold text-surface-on">{val}</span>
    },
    {
      key: 'vehicle_type',
      label: 'Type',
      sortable: true,
      render: (val: any) => (
        <span className="capitalize text-surface-on-variant">{val}</span>
      )
    },
    {
      key: 'pulsit_device_id',
      label: 'Pulsit Device',
      render: (val: any) => (
        <span className="font-mono text-xs tracking-wider text-surface-on-variant">{val}</span>
      )
    },
    {
      key: 'is_active',
      label: 'Status',
      sortable: true,
      render: (val: any) => (
        <Chip kind={val ? 'success' : 'neutral'}>
          {val ? 'Active' : 'Inactive'}
        </Chip>
      )
    }
  ] as any

  return (
    <PageShell>
      <PageHeader
        title="Vehicles"
        actions={
          <Button size="sm" iconLeft={<Plus className="w-4 h-4" />}>
            Add Vehicle
          </Button>
        }
      />
      
      <DataTable
        columns={columns}
        rows={vehicles as unknown as any[]}
        empty={{ title: 'No vehicles', body: 'No vehicles found in the fleet.' }}
      />
    </PageShell>
  )
}
