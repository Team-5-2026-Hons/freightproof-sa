'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui/TopBar'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { FormField } from '@/components/ui/FormField'
import { Ic } from '@/components/ui/Ic'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useToast } from '@/lib/hooks/useToast'
import { api } from '@/lib/api/client'
import type { Column } from '@/components/ui/DataTable'
import type { Driver } from '@shared/lib/types/driver'
import {
  validateDriverForm,
  phoneFieldFeedback,
  normalisePhone,
  DRIVER_FIELD_ORDER,
  type DriverField,
  type DriverFormValues,
} from '@shared/lib/validation/driver'
import { SA_ID_LENGTH } from '@shared/lib/validation/constants'
import { AdminOnly } from '@/components/auth/AdminOnly'

// Days until a date string expires — negative means already expired.
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function ExpiryCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-surface-on-variant text-sm">—</span>
  const days = daysUntil(value)!
  const label = new Date(value).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  // Colour-code: red ≤30 days (including expired), amber ≤90, green otherwise.
  const colour =
    days <= 30 ? 'text-red-500' :
    days <= 90 ? 'text-amber-500' :
    'text-surface-on'
  return <span className={`text-sm tabular-nums ${colour}`}>{label}</span>
}

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
    key: 'license_expiry',
    label: 'Licence Expiry',
    render: (_val, row) => <ExpiryCell value={row.license_expiry} />,
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

type StatusFilter = 'all' | 'active' | 'inactive'
type SortOption = 'created-desc' | 'created-asc' | 'name-asc' | 'name-desc' | 'expiry-asc' | 'expiry-desc'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'created-desc', label: 'Newest first' },
  { value: 'created-asc',  label: 'Oldest first' },
  { value: 'name-asc',     label: 'Name A–Z' },
  { value: 'name-desc',    label: 'Name Z–A' },
  { value: 'expiry-asc',   label: 'Licence Expiry — Soonest' },
  { value: 'expiry-desc',  label: 'Licence Expiry — Latest' },
]

function sortDrivers(drivers: Driver[], option: SortOption): Driver[] {
  const sorted = [...drivers]
  switch (option) {
    case 'created-desc':
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      break
    case 'created-asc':
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      break
    case 'name-asc':
      sorted.sort((a, b) => a.full_name.localeCompare(b.full_name))
      break
    case 'name-desc':
      sorted.sort((a, b) => b.full_name.localeCompare(a.full_name))
      break
    case 'expiry-asc':
      sorted.sort((a, b) => {
        // Null expiry always sorts last.
        if (!a.license_expiry && !b.license_expiry) return 0
        if (!a.license_expiry) return 1
        if (!b.license_expiry) return -1
        return new Date(a.license_expiry).getTime() - new Date(b.license_expiry).getTime()
      })
      break
    case 'expiry-desc':
      sorted.sort((a, b) => {
        if (!a.license_expiry && !b.license_expiry) return 0
        if (!a.license_expiry) return 1
        if (!b.license_expiry) return -1
        return new Date(b.license_expiry).getTime() - new Date(a.license_expiry).getTime()
      })
      break
  }
  return sorted
}

const EMPTY_FORM: DriverFormValues = {
  full_name: '',
  id_number: '',
  phone_number: '',
  license_number: '',
  license_expiry: '',
}

export default function FleetDriversPage(): React.JSX.Element {
  const router = useRouter()
  const { drivers, isLoading, error: fetchError, refetch } = useDrivers()
  const { notify } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<DriverFormValues>(EMPTY_FORM)
  const [touched, setTouched] = useState<Set<DriverField>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // List controls — parity with the vehicles page.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortOption, setSortOption] = useState<SortOption>('created-desc')

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load drivers', body: fetchError })
    }
  }, [fetchError, notify])

  // Derived each render — pure and cheap.
  const errors = validateDriverForm(form)
  const hasErrors = Object.values(errors).some((e) => e !== null)
  const phoneFeedback = phoneFieldFeedback(form.phone_number)

  const filteredDrivers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = drivers.filter((d) => {
      if (statusFilter === 'active' && !d.is_active) return false
      if (statusFilter === 'inactive' && d.is_active) return false
      if (q.length === 0) return true
      return (
        d.full_name.toLowerCase().includes(q) ||
        d.phone_number.toLowerCase().includes(q) ||
        d.license_number.toLowerCase().includes(q) ||
        // id_number is unmasked here — dispatchers search by ID in their records
        d.id_number.includes(q)
      )
    })
    return sortDrivers(filtered, sortOption)
  }, [drivers, search, statusFilter, sortOption])

  function handleChange(field: string, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }))
    setTouched((prev) => {
      const next = new Set(prev)
      next.add(field as DriverField)
      return next
    })
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setTouched(new Set())
    setFormError(null)
  }

  async function handleSubmit(): Promise<void> {
    // Defensive re-validate — the disabled Save button blocks the common path.
    if (hasErrors) {
      setTouched(new Set(DRIVER_FIELD_ORDER))
      const firstInvalidField = DRIVER_FIELD_ORDER.find((field) => errors[field] !== null)
      if (firstInvalidField) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      }
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      await api.post('/api/v1/drivers', {
        ...form,
        phone_number: normalisePhone(form.phone_number),
        license_expiry: form.license_expiry || null,
      })
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
      <TopBar title="Drivers">
        <AdminOnly>
          <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
            Add Driver
          </Button>
        </AdminOnly>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        {/* List controls — matches vehicles page design exactly */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[140px]">
            <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, licence, or ID…"
              className="w-full pl-8 pr-4 py-2 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf placeholder:text-on-surf-v/60 outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
            />
          </div>

          <div className="relative shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="appearance-none py-2 pl-3 pr-8 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            <Ic n="chev" s={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
          </div>

          <div className="relative shrink-0">
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="appearance-none py-2 pl-3 pr-8 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <Ic n="chev" s={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
          </div>
        </div>

        <DataTable<Driver>
          columns={columns}
          rows={filteredDrivers}
          isLoading={isLoading}
          error={fetchError}
          onRetry={refetch}
          onRowClick={(d) => router.push(`/fleet/drivers/${d.id}`)}
          empty={{ title: 'No drivers', body: 'No drivers match your filters.' }}
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
            <Button size="sm" loading={submitting} disabled={hasErrors || submitting} onClick={handleSubmit}>
              Save Driver
            </Button>
          </>
        }
      >
        {formError && (
          <p className="mb-4 text-sm text-red-500">{formError}</p>
        )}
        <div className="flex flex-col gap-4">
          <FormField label="Full Name" name="full_name" value={form.full_name} onChange={handleChange} placeholder="e.g. Sipho Dlamini" error={touched.has('full_name') ? errors.full_name ?? undefined : undefined} />
          <FormField label="SA ID Number (13 digits)" name="id_number" value={form.id_number} onChange={handleChange} placeholder="8001015009087" maxLength={SA_ID_LENGTH} inputMode="numeric" error={touched.has('id_number') ? errors.id_number ?? undefined : undefined} />
          <FormField label="Phone Number" name="phone_number" value={form.phone_number} onChange={handleChange} placeholder="0821234567 or +27821234567" helperText={phoneFeedback.hint ?? undefined} error={phoneFeedback.error ?? (touched.has('phone_number') ? errors.phone_number ?? undefined : undefined)} />
          <FormField label="Licence Number" name="license_number" value={form.license_number} onChange={handleChange} placeholder="DRV-001" error={touched.has('license_number') ? errors.license_number ?? undefined : undefined} />
          <FormField label="Licence Expiry" name="license_expiry" type="date" value={form.license_expiry} onChange={handleChange} error={touched.has('license_expiry') ? errors.license_expiry ?? undefined : undefined} />
        </div>
      </Modal>
    </div>
  )
}
