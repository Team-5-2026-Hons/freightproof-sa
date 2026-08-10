'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Plus, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Ic } from '@/components/ui/Ic'
import { FormField } from '@/components/ui/FormField'
import { VehicleCard } from '@/components/vehicles/VehicleCard'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { useToast } from '@/lib/hooks/useToast'
import { api } from '@/lib/api/client'
import { cn } from '@shared/lib/utils/cn'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { validateVehicleForm, vinFieldFeedback, VEHICLE_FIELD_ORDER, type VehicleField } from '@shared/lib/validation/vehicle'
import { VIN_LENGTH } from '@shared/lib/validation/constants'
import { AdminOnly } from '@/components/auth/AdminOnly'

type TypeFilter = 'all' | 'horse' | 'trailer'
type StatusFilter = 'all' | 'active' | 'inactive'
type LengthFilter = 'all' | '6' | '12' | '18'
type SortOption = 'registration-asc' | 'registration-desc' | 'year-desc' | 'year-asc' | 'licence-asc'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'registration-asc', label: 'Registration A–Z' },
  { value: 'registration-desc', label: 'Registration Z–A' },
  { value: 'year-desc', label: 'Year — Newest' },
  { value: 'year-asc', label: 'Year — Oldest' },
  { value: 'licence-asc', label: 'Licence Disc Expiry — Soonest' },
]

function sortVehicles(vehicles: Vehicle[], option: SortOption): Vehicle[] {
  const sorted = [...vehicles]
  switch (option) {
    case 'registration-asc':
      sorted.sort((a, b) => a.registration.localeCompare(b.registration))
      break
    case 'registration-desc':
      sorted.sort((a, b) => b.registration.localeCompare(a.registration))
      break
    case 'year-desc':
      sorted.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity))
      break
    case 'year-asc':
      sorted.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity))
      break
    case 'licence-asc':
      sorted.sort((a, b) => {
        const aTime = a.licence_disc_expiry ? new Date(a.licence_disc_expiry).getTime() : Infinity
        const bTime = b.licence_disc_expiry ? new Date(b.licence_disc_expiry).getTime() : Infinity
        return aTime - bTime
      })
      break
  }
  return sorted
}

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
  length_m: string
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
  length_m: '',
}

export default function FleetVehiclesPage(): React.JSX.Element {
  const router = useRouter()
  const { all: vehicles, horses, trailers, isLoading, error: fetchError, refetch } = useVehicles()
  const { notify } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VehicleFormState>(EMPTY_FORM)
  const [touched, setTouched] = useState<Set<VehicleField>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>('all')
  const [sortOption, setSortOption] = useState<SortOption>('registration-asc')
  const [search, setSearch] = useState('')

  // Derived on every render — validateVehicleForm is pure and cheap. `form`
  // (VehicleFormState) satisfies VehicleFormValues directly since every
  // VehicleField key is typed string on VehicleFormState too.
  const errors = validateVehicleForm(form)
  const hasErrors = Object.values(errors).some((e) => e !== null)
  // VIN gets live feedback the moment the user types (not touched-gated): a neutral
  // character count while still entering, a red error only once it's the wrong shape.
  const vinFeedback = vinFieldFeedback(form.vin_number)

  useEffect(() => {
    if (fetchError) {
      notify({ kind: 'error', title: 'Failed to load vehicles', body: fetchError })
    }
  }, [fetchError, notify])

  const visibleVehicles = useMemo(() => {
    const byType = typeFilter === 'all' ? vehicles : typeFilter === 'horse' ? horses : trailers
    const byStatus = byType.filter((v) => {
      if (statusFilter === 'active') return v.is_active
      if (statusFilter === 'inactive') return !v.is_active
      return true
    })
    const byLength = lengthFilter === 'all'
      ? byStatus
      : byStatus.filter((v) => v.length_m === Number(lengthFilter))
    const query = search.trim().toLowerCase()
    const bySearch = query
      ? byLength.filter((v) =>
          [v.registration, v.make, v.model, v.vin_number]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(query)),
        )
      : byLength
    return sortVehicles(bySearch, sortOption)
  }, [vehicles, horses, trailers, typeFilter, statusFilter, lengthFilter, search, sortOption])

  function clearFilters(): void {
    setTypeFilter('all')
    setStatusFilter('all')
    setLengthFilter('all')
    setSearch('')
  }

  function handleChange<K extends keyof VehicleFormState>(field: K, value: VehicleFormState[K]): void {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // FormField's onChange is (name: string, value: string) => void; this adapts
  // it to the generic setter above and marks the field touched for error gating.
  function handleFieldChange(name: string, value: string): void {
    handleChange(name as keyof VehicleFormState, value)
    setTouched((prev) => new Set(prev).add(name as VehicleField))
  }

  function handleClose(): void {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setTouched(new Set())
    setFormError(null)
  }

  async function handleSubmit(): Promise<void> {
    // Defensive re-validate: the disabled Save button already blocks this
    // in the common path, but guard here too (e.g. a future Enter-key submit).
    if (hasErrors) {
      setTouched(new Set(VEHICLE_FIELD_ORDER))
      const firstInvalidField = VEHICLE_FIELD_ORDER.find((field) => errors[field] !== null)
      if (firstInvalidField) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      }
      return
    }

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
        length_m: form.vehicle_type === 'trailer' && form.length_m ? parseInt(form.length_m, 10) : null,
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
      <TopBar title="Vehicles">
        <AdminOnly>
          <Button size="sm" iconLeft={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>
            Add Vehicle
          </Button>
        </AdminOnly>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type filter — compact segmented control, matches Label-S table-header scale */}
          <div className="flex items-center gap-[2px] bg-surf-low rounded-md p-[3px] shrink-0">
            {([
              { id: 'all', label: `All (${vehicles.length})` },
              { id: 'horse', label: `Horses (${horses.length})` },
              { id: 'trailer', label: `Trailers (${trailers.length})` },
            ] as { id: TypeFilter; label: string }[]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTypeFilter(opt.id)}
                className={cn(
                  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase transition-colors',
                  typeFilter === opt.id
                    ? 'bg-surf-lowest text-on-surf shadow-level-1'
                    : 'text-on-surf-v hover:text-on-surf',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[140px]">
            <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
            <input
              type="text"
              placeholder="Registration, make, model, VIN…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
              value={lengthFilter}
              onChange={(e) => setLengthFilter(e.target.value as LengthFilter)}
              className="appearance-none py-2 pl-3 pr-8 text-[13px] bg-surf-low rounded-md border border-outline-v/30 text-on-surf outline-none focus:border-sec focus:bg-surf-lowest transition-colors"
            >
              <option value="all">Any length</option>
              <option value="6">6 m</option>
              <option value="12">12 m</option>
              <option value="18">18 m</option>
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

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : fetchError ? (
          <EmptyState
            icon={<AlertCircle />}
            title="Failed to load"
            body={fetchError}
            cta={
              <Button size="sm" variant="ghost" onClick={refetch}>
                Try again
              </Button>
            }
          />
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon={<Ic n="truck" s={32} />}
            title="No vehicles"
            body="No vehicles registered yet."
          />
        ) : visibleVehicles.length === 0 ? (
          <EmptyState
            icon={<Ic n="search" s={32} />}
            title="No matches"
            body="No vehicles match your filters."
            cta={
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleVehicles.map((v) => (
              <VehicleCard key={v.id} vehicle={v} onClick={() => router.push(`/fleet/vehicles/${v.id}`)} />
            ))}
          </div>
        )}
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
            <Button size="sm" loading={submitting} disabled={hasErrors || submitting} onClick={handleSubmit}>
              Save Vehicle
            </Button>
          </>
        }
      >
        {formError && (
          <p className="mb-4 text-sm text-red-500">{formError}</p>
        )}
        <div className="flex flex-col gap-4">
          <FormField
            label="Registration"
            name="registration"
            value={form.registration}
            onChange={handleFieldChange}
            placeholder="CA 123-456"
            required
            error={touched.has('registration') ? errors.registration ?? undefined : undefined}
          />
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
            <FormField
              label="Make"
              name="make"
              value={form.make}
              onChange={handleFieldChange}
              placeholder="Volvo"
              error={touched.has('make') ? errors.make ?? undefined : undefined}
            />
            <FormField
              label="Model"
              name="model"
              value={form.model}
              onChange={handleFieldChange}
              placeholder="FH16"
              error={touched.has('model') ? errors.model ?? undefined : undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Year"
              name="year"
              type="number"
              inputMode="numeric"
              value={form.year}
              onChange={handleFieldChange}
              placeholder="2021"
              error={touched.has('year') ? errors.year ?? undefined : undefined}
            />
            <FormField
              label="GVM (kg)"
              name="gross_vehicle_mass_kg"
              type="number"
              inputMode="numeric"
              value={form.gross_vehicle_mass_kg}
              onChange={handleFieldChange}
              placeholder="56000"
              error={touched.has('gross_vehicle_mass_kg') ? errors.gross_vehicle_mass_kg ?? undefined : undefined}
            />
          </div>
          {form.vehicle_type === 'trailer' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">Trailer Length *</span>
              <select
                className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.length_m}
                onChange={(e) => handleChange('length_m', e.target.value)}
              >
                <option value="">Select length…</option>
                <option value="6">6 m</option>
                <option value="12">12 m</option>
                <option value="18">18 m</option>
              </select>
            </label>
          )}
          <FormField
            label="VIN Number"
            name="vin_number"
            value={form.vin_number}
            onChange={handleFieldChange}
            placeholder="WVW ZZZ 1K ZBW 012345"
            maxLength={VIN_LENGTH}
            helperText={vinFeedback.hint ?? undefined}
            error={vinFeedback.error ?? undefined}
          />
          <FormField
            label="Licence Disc Expiry"
            name="licence_disc_expiry"
            type="date"
            value={form.licence_disc_expiry}
            onChange={handleFieldChange}
            error={touched.has('licence_disc_expiry') ? errors.licence_disc_expiry ?? undefined : undefined}
          />
          <FormField
            label="Pulsit Device ID"
            name="pulsit_device_id"
            value={form.pulsit_device_id}
            onChange={handleFieldChange}
            placeholder="PLT-HORSE-001"
            required
            error={touched.has('pulsit_device_id') ? errors.pulsit_device_id ?? undefined : undefined}
          />
        </div>
      </Modal>
    </div>
  )
}
