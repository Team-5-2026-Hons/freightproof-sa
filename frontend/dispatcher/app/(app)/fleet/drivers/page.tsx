'use client'

import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useToast } from '@/lib/hooks/useToast'
import { TimestampWithIcon } from '@/components/domain/TimestampWithIcon'
import { api } from '@/lib/api/client'
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

interface DriverFormState {
  full_name: string
  id_number: string
  phone_number: string
  license_number: string
}

const EMPTY_FORM: DriverFormState = {
  full_name: '',
  id_number: '',
  phone_number: '',
  license_number: '',
}

export default function FleetDriversPage(): React.JSX.Element {
  const { drivers, isLoading, error: fetchError, refetch } = useDrivers()
  const { notify } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<DriverFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load drivers', body: fetchError })
    }
  }, [fetchError, notify])

  function handleChange(field: keyof DriverFormState, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function normalisePhone(phone: string): string {
    const digits = phone.replace(/\s+/g, '')
    // Convert local SA format (0XXXXXXXXX) to international (+27XXXXXXXXX)
    if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`
    return digits
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setFormError(null)
    try {
      await api.post('/api/v1/drivers', { ...form, phone_number: normalisePhone(form.phone_number) })
      handleClose()
      refetch()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create driver')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Fleet — Drivers">
        <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
          Add Driver
        </Button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6">
        <DataTable<Driver>
          columns={columns}
          rows={drivers}
          isLoading={isLoading}
          error={fetchError}
          onRetry={refetch}
          empty={{ title: 'No drivers', body: 'No drivers registered yet.' }}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={handleClose}
        title="Add Driver"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" loading={submitting} onClick={handleSubmit}>
              Save Driver
            </Button>
          </>
        }
      >
        {formError && (
          <p className="mb-4 text-sm text-red-500">{formError}</p>
        )}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Full Name</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.full_name}
              onChange={(e) => handleChange('full_name', e.target.value)}
              placeholder="e.g. Sipho Dlamini"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">SA ID Number (13 digits)</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary font-mono tracking-widest"
              value={form.id_number}
              onChange={(e) => handleChange('id_number', e.target.value)}
              placeholder="8001015009087"
              maxLength={13}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Phone Number</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.phone_number}
              onChange={(e) => handleChange('phone_number', e.target.value)}
              placeholder="0821234567 or +27821234567"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-on-variant">Licence Number</span>
            <input
              className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.license_number}
              onChange={(e) => handleChange('license_number', e.target.value)}
              placeholder="DRV-001"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
