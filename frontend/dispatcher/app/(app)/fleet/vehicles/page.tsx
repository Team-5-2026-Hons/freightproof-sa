'use client'

import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { useToast } from '@/lib/hooks/useToast'
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
    key: 'make',
    label: 'Make / Model',
    render: (val, row) => (
      <span className="text-sm text-surface-on">
        {[val, row.model].filter(Boolean).join(' ') || '—'}
      </span>
    ),
  },
  {
    key: 'year',
    label: 'Year',
    render: (val) => (
      <span className="text-sm text-surface-on-variant">{val ?? '—'}</span>
    ),
  },
  {
    key: 'vin_number',
    label: 'VIN',
    render: (val) => (
      <span className="font-mono text-xs tracking-wider text-surface-on-variant">{val ?? '—'}</span>
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
  make: string
  model: string
  year: string
  vin_number: string
  licence_disc_expiry: string
  gross_vehicle_mass_kg: string
}

const EMPTY_FORM: VehicleFormState = {
  registration: '',
  vehicle_type: 'horse',
  pulsit_device_id: '',
  make: '',
  model: '',
  year: '',
  vin_number: '',
  licence_disc_expiry: '',
  gross_vehicle_mass_kg: '',
}

export default function FleetVehiclesPage(): React.JSX.Element {
  const router = useRouter()
  const { all: vehicles, isLoading, error: fetchError, refetch } = useVehicles()
  const { notify } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VehicleFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load vehicles', body: fetchError })
    }
  }, [fetchError, notify])

  function handleChange<K extends keyof VehicleFormState>(field: K, value: VehicleFormState[K]): void {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setFormError(null)
    try {
      await api.post('/api/v1/vehicles', {
        registration: form.registration,
        vehicle_type: form.vehicle_type,
        pulsit_device_id: form.pulsit_device_id,
        make: form.make || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year, 10) : null,
        vin_number: form.vin_number || null,
        licence_disc_expiry: form.licence_disc_expiry || null,
        gross_vehicle_mass_kg: form.gross_vehicle_mass_kg ? parseInt(form.gross_vehicle_mass_kg, 10) : null,
      })
      handleClose()
      refetch()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create vehicle')
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
          isLoading={isLoading}
          error={fetchError}
          onRetry={refetch}
          onRowClick={(v) => router.push(`/fleet/vehicles/${v.id}`)}
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
        {formError && (
          <p className="mb-4 text-sm text-red-500">{formError}</p>
        )}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Registration *</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono tracking-widest uppercase"
              value={form.registration}
              onChange={(e) => handleChange('registration', e.target.value)}
              placeholder="CA 123-456"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Type *</span>
            <select
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.vehicle_type}
              onChange={(e) => handleChange('vehicle_type', e.target.value as 'horse' | 'trailer')}
            >
              <option value="horse">Horse (truck)</option>
              <option value="trailer">Trailer</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">Make</span>
              <input
                className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.make}
                onChange={(e) => handleChange('make', e.target.value)}
                placeholder="Volvo"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">Model</span>
              <input
                className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.model}
                onChange={(e) => handleChange('model', e.target.value)}
                placeholder="FH16"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">Year</span>
              <input
                type="number"
                className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.year}
                onChange={(e) => handleChange('year', e.target.value)}
                placeholder="2021"
                min={1990}
                max={new Date().getFullYear() + 1}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">GVM (kg)</span>
              <input
                type="number"
                className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.gross_vehicle_mass_kg}
                onChange={(e) => handleChange('gross_vehicle_mass_kg', e.target.value)}
                placeholder="56000"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">VIN Number</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono tracking-widest uppercase"
              value={form.vin_number}
              onChange={(e) => handleChange('vin_number', e.target.value)}
              placeholder="WVW ZZZ 1K ZBW 012345"
              maxLength={17}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Licence Disc Expiry</span>
            <input
              type="date"
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.licence_disc_expiry}
              onChange={(e) => handleChange('licence_disc_expiry', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Pulsit Device ID *</span>
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
