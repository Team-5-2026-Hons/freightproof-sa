'use client'

import { Plus } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import type { Column } from '@/components/ui/DataTable'
import type { Driver } from '@shared/lib/types/driver'

const columns: Column<Driver>[] = [
  {
    key: 'full_name',
    label: 'Name',
    sortable: true,
    render: (val) => <span className="font-bold text-surface-on">{String(val)}</span>,
  },
  {
    key: 'id_number',
    label: 'ID Number',
    render: (val) => (
      <span className="font-mono text-xs tracking-wider text-surface-on-variant">
        {/* Mask for POPIA compliance — show only last 4 digits */}
        ···· {String(val).slice(-4)}
      </span>
    ),
  },
  {
    key: 'phone_number',
    label: 'Phone',
    render: (val) => <span className="text-sm text-surface-on">{String(val)}</span>,
  },
  {
    key: 'idvs_status',
    label: 'Verification',
    sortable: true,
    render: (val, row) => (
      <div className="flex flex-col gap-1">
        <Chip
          type={val === 'verified' ? 'complete' : val === 'failed' ? 'critical' : 'pending'}
          label={String(val)}
        />
        {val === 'verified' && row.idvs_last_verified_at && (
          <TimestampWithIcon
            timestamp={String(row.idvs_last_verified_at)}
            className="text-xs text-surface-on-variant"
          />
        )}
      </div>
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

export default function FleetDriversPage() {
  const drivers = useDrivers()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Fleet — Drivers">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />}>
          Add Driver
        </Button>
      </TopBar>
      <div className="flex-1 overflow-y-auto p-6">
        <DataTable<Driver>
          columns={columns}
          rows={drivers}
          empty={{ title: 'No drivers', body: 'No drivers registered yet.' }}
        />
      </div>
    </div>
  )
}
