'use client'

import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { api } from '@/lib/api/client'
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

interface VehicleFormState {
  registration: string
  vehicle_type: 'horse' | 'trailer'
  pulsit_device_id: string
}

const EMPTY_FORM: VehicleFormState = {
  registration: '',
  vehicle_type: 'horse',
  pulsit_device_id: '',
}

export default function FleetVehiclesPage(): React.JSX.Element {
  const { all: vehicles, refetch } = useVehicles()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VehicleFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleChange<K extends keyof VehicleFormState>(field: K, value: VehicleFormState[K]): void {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/v1/vehicles', form)
      handleClose()
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vehicle')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Fleet — Vehicles">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
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

      <Modal
        open={modalOpen}
        onClose={handleClose}
        title="Add Vehicle"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" loading={submitting} onClick={handleSubmit}>
              Save Vehicle
            </Button>
          </>
        }
      >
        {error && (
          <p className="mb-4 text-sm text-red-500">{error}</p>
        )}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Registration</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono tracking-widest uppercase"
              value={form.registration}
              onChange={(e) => handleChange('registration', e.target.value)}
              placeholder="CA 123-456"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Type</span>
            <select
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.vehicle_type}
              onChange={(e) => handleChange('vehicle_type', e.target.value as 'horse' | 'trailer')}
            >
              <option value="horse">Horse (truck)</option>
              <option value="trailer">Trailer</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Pulsit Device ID</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              value={form.pulsit_device_id}
              onChange={(e) => handleChange('pulsit_device_id', e.target.value)}
              placeholder="PLT-HORSE-001"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
