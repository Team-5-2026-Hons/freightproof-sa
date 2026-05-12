'use client'

import { Users, Plus } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import type { Driver } from '@shared/lib/types/driver'

export default function FleetDriversPage() {
  const drivers = useDrivers()

  const columns = [
    {
      key: 'full_name',
      label: 'Name',
      sortable: true,
      render: (val: any) => <span className="font-bold text-surface-on">{val}</span>
    },
    {
      key: 'id_number',
      label: 'ID Number',
      render: (val: any) => (
        <span className="font-mono text-xs tracking-wider text-surface-on-variant">{val}</span>
      )
    },
    {
      key: 'phone_number',
      label: 'Phone',
      render: (val: any) => <span className="text-sm text-surface-on">{val}</span>
    },
    {
      key: 'idvs_status',
      label: 'Verification',
      sortable: true,
      render: (val: any, row: any) => (
        <div className="flex flex-col gap-1">
          <Chip kind={val === 'verified' ? 'success' : val === 'failed' ? 'error' : 'pending'} className="w-fit">
            {val}
          </Chip>
          {val === 'verified' && row.idvs_last_verified_at && (
            <TimestampWithIcon timestamp={row.idvs_last_verified_at} className="text-xs text-surface-on-variant" />
          )}
        </div>
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
        title="Drivers"
        actions={
          <Button size="sm" iconLeft={<Plus className="w-4 h-4" />}>
            Add Driver
          </Button>
        }
      />
      
      <DataTable
        columns={columns}
        rows={drivers as unknown as any[]}
        empty={{ title: 'No drivers', body: 'No drivers found in the fleet.' }}
      />
    </PageShell>
  )
}
