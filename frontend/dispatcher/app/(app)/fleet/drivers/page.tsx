'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { AlertCircle, PackageOpen } from 'lucide-react'
import { TopBar } from '@/components/ui/TopBar'
import { SecHead } from '@/components/ui/SecHead'
import { Table } from '@/components/ui/Table'
import { SearchField } from '@/components/ui/SearchField'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { FormField } from '@/components/ui/FormField'
import { buildDriverColumns, DRIVER_TABLE_ID } from '@/components/drivers/driverColumns'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useNow } from '@/lib/hooks/useNow'
import { useToast } from '@/lib/hooks/useToast'
import { api } from '@/lib/api/client'
import { DEFAULT_DRIVER_SORT, defaultDriverSortDirection, DRIVER_SORT_KEYS, sortDrivers } from '@/lib/drivers/sort'
import { useTableSort } from '@/lib/hooks/useTableSort'
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

type StatusFilter = 'all' | 'active' | 'inactive'

const STATUS_OPTIONS = [
  { value: 'all' as const, label: 'All statuses' },
  { value: 'active' as const, label: 'Active only' },
  { value: 'inactive' as const, label: 'Inactive only' },
]

// Licence colours change on a day boundary, so an hourly refresh is plenty for a tab left open.
const CLOCK_TICK_MS = 3_600_000

const EMPTY_FORM: DriverFormValues = {
  full_name: '',
  id_number: '',
  phone_number: '',
  license_number: '',
  license_expiry: '',
}

export default function FleetDriversPage(): React.JSX.Element {
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
  const { sort, tableSort, onSort } = useTableSort({ keys: DRIVER_SORT_KEYS, firstDir: defaultDriverSortDirection, initial: DEFAULT_DRIVER_SORT })
  const now = useNow(CLOCK_TICK_MS)

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
    return sortDrivers(filtered, sort)
  }, [drivers, search, statusFilter, sort])

  const columns = useMemo(() => buildDriverColumns({ now }), [now])

  // Placeholder rows only on the first load: a refetch (after adding a driver) swaps rows in place.
  const initialLoad = isLoading && drivers.length === 0

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

      <ListToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Name, phone, licence, or ID…" ariaLabel="Search drivers by name, phone, licence, or ID" />
        <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} ariaLabel="Status" />
      </ListToolbar>

      <div className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surf-lowest shadow-level-3">
        <SecHead title="Drivers" />
        {fetchError ? (
          <EmptyState
            icon={<AlertCircle />}
            title="Failed to load"
            body={fetchError}
            cta={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
          />
        ) : !initialLoad && filteredDrivers.length === 0 ? (
          <EmptyState icon={<PackageOpen />} title="No drivers" body="No drivers match your filters." />
        ) : (
          <Table<Driver>
            tableId={DRIVER_TABLE_ID}
            caption="Drivers"
            isLoading={initialLoad}
            loadingLabel="Loading drivers"
            columns={columns}
            rows={filteredDrivers}
            getRowKey={driver => driver.id}
            sort={tableSort}
            onSort={onSort}
            density="compact"
            className="min-h-0 flex-1"
          />
        )}
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
