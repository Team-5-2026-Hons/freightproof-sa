'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }    from '@/components/ui/TopBar'
import { Chip }      from '@/components/ui/Chip'
import { Spinner }   from '@/components/ui/Spinner'
import { Button }    from '@/components/ui/Button'
import { Ic }        from '@/components/ui/Ic'
import { InfoRow }   from '@/components/ui/InfoRow'
import { FormField } from '@/components/ui/FormField'
import { Switch }    from '@/components/ui/Switch'
import { BlockchainBadge } from '@/components/blockchain/BlockchainBadge'
import { EventTimeline }   from '@/components/blockchain/EventTimeline'
import { ForensicOnly }    from '@/components/blockchain/ForensicOnly'
import { useVehicleDetail } from '@/lib/hooks/useVehicleDetail'
import {
  useResizablePanel,
  DETAIL_PANEL_DEFAULT_W,
  DETAIL_PANEL_MIN_W,
  DETAIL_PANEL_MAX_W,
} from '@/lib/hooks/useResizablePanel'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'
import { validateVehicleForm, vinFieldFeedback, VEHICLE_FIELD_ORDER, type VehicleField } from '@shared/lib/validation/vehicle'
import { VIN_LENGTH } from '@shared/lib/validation/constants'

type EditState = {
  registration: string
  pulsit_device_id: string
  vin_number: string
  licence_disc_expiry: string
  make: string
  model: string
  year: string
  gross_vehicle_mass_kg: string
  length_m: string
  is_active: boolean
}

export default function VehicleDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { data: vehicle, isLoading, error, refetchSilent } = useVehicleDetail(params.id)

  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<EditState | null>(null)
  const [touched, setTouched] = useState<Set<VehicleField>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { width: panelWidth, startResize } = useResizablePanel(
    DETAIL_PANEL_DEFAULT_W,
    { min: DETAIL_PANEL_MIN_W, max: DETAIL_PANEL_MAX_W },
  )

  const backButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => router.push(ROUTES.fleetVehicles)}
      iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
    >
      Back
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Vehicle" left={backButton} />
        <div className="flex items-center justify-center flex-1">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error || !vehicle) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Vehicle not found" left={backButton} />
        <div className="p-6 text-[13px] text-on-surf-v">Could not load vehicle.</div>
      </div>
    )
  }

  const latestReceipt = vehicle.receipts[0] ?? null
  const typeLabel = vehicle.vehicle_type === 'horse' ? 'Horse' : 'Trailer'
  const subtitle = [vehicle.make, vehicle.model, vehicle.year ? String(vehicle.year) : null]
    .filter(Boolean).join(' ')

  // Derived on every render — validateVehicleForm is pure and cheap, same
  // treatment as latestReceipt/typeLabel above. `form` (EditState) satisfies
  // VehicleFormValues directly since every VehicleField key is typed string
  // on EditState too.
  const errors = form ? validateVehicleForm(form) : null
  const hasErrors = errors ? Object.values(errors).some((e) => e !== null) : false
  // VIN gets live feedback the moment the user types (not touched-gated): a neutral
  // character count while still entering, a red error only once it's the wrong shape.
  const vinFeedback = form ? vinFieldFeedback(form.vin_number) : null

  function startEdit() {
    setForm({
      registration: vehicle!.registration,
      pulsit_device_id: vehicle!.pulsit_device_id,
      vin_number: vehicle!.vin_number ?? '',
      licence_disc_expiry: vehicle!.licence_disc_expiry ?? '',
      make: vehicle!.make ?? '',
      model: vehicle!.model ?? '',
      year: vehicle!.year != null ? String(vehicle!.year) : '',
      gross_vehicle_mass_kg: vehicle!.gross_vehicle_mass_kg != null ? String(vehicle!.gross_vehicle_mass_kg) : '',
      length_m: vehicle!.length_m != null ? String(vehicle!.length_m) : '',
      is_active: vehicle!.is_active,
    })
    setTouched(new Set())
    setSaveError(null)
    setIsEditing(true)
  }

  function handleFieldChange(name: string, value: string) {
    setForm((prev) => prev ? { ...prev, [name]: value } : prev)
    setTouched((prev) => {
      const next = new Set(prev)
      next.add(name as VehicleField)
      return next
    })
  }

  async function handleSave() {
    if (!form) return

    // Defensive re-validate: the disabled Save button already blocks this
    // in the common path, but guard here too (e.g. a future Enter-key submit).
    if (errors && hasErrors) {
      setTouched(new Set(VEHICLE_FIELD_ORDER))
      const firstInvalidField = VEHICLE_FIELD_ORDER.find((field) => errors[field] !== null)
      if (firstInvalidField) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      }
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const body: Record<string, unknown> = {}
      if (form.registration !== vehicle!.registration) body.registration = form.registration
      if (form.pulsit_device_id !== vehicle!.pulsit_device_id) body.pulsit_device_id = form.pulsit_device_id
      if (form.vin_number !== (vehicle!.vin_number ?? '')) body.vin_number = form.vin_number || null
      if (form.licence_disc_expiry !== (vehicle!.licence_disc_expiry ?? '')) body.licence_disc_expiry = form.licence_disc_expiry || null
      if (form.make !== (vehicle!.make ?? '')) body.make = form.make || null
      if (form.model !== (vehicle!.model ?? '')) body.model = form.model || null
      if (form.year !== (vehicle!.year != null ? String(vehicle!.year) : '')) body.year = form.year ? parseInt(form.year, 10) : null
      if (form.gross_vehicle_mass_kg !== (vehicle!.gross_vehicle_mass_kg != null ? String(vehicle!.gross_vehicle_mass_kg) : '')) {
        body.gross_vehicle_mass_kg = form.gross_vehicle_mass_kg ? parseInt(form.gross_vehicle_mass_kg, 10) : null
      }
      if (form.length_m !== (vehicle!.length_m != null ? String(vehicle!.length_m) : '')) {
        body.length_m = form.length_m ? parseInt(form.length_m, 10) : null
      }
      if (form.is_active !== vehicle!.is_active) body.is_active = form.is_active

      if (Object.keys(body).length === 0) { setIsEditing(false); return }
      await api.patch(`/api/v1/vehicles/${vehicle!.id}`, body)
      await refetchSilent()
      setIsEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title={vehicle.registration}
        sub={[typeLabel, subtitle].filter(Boolean).join(' · ')}
        left={backButton}
      >
        <Chip type={vehicle.is_active ? 'complete' : 'pending'} label={vehicle.is_active ? 'Active' : 'Inactive'} />
      </TopBar>

      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — resizable vehicle info column, widest default + drag-to-resize */}
        <div
          style={{ width: panelWidth }}
          className="relative shrink-0 overflow-y-auto bg-surf-low border-r border-outline-v/20 p-5"
        >

          {/* Resize handle — hover to reveal, drag to resize (mirrors trip history table columns) */}
          <div
            onMouseDown={startResize}
            className="absolute top-0 right-0 -mr-2 h-full w-4 cursor-col-resize flex items-center justify-center group z-10"
          >
            <div className="w-[2px] h-10 rounded-full bg-outline-v/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Vehicle info */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Vehicle Info
            </div>
            {!isEditing && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                Edit
              </Button>
            )}
          </div>

          {isEditing && form ? (
            <div className="flex flex-col gap-3 mb-4">
              <FormField label="Registration"        name="registration"        value={form.registration}        onChange={handleFieldChange} error={touched.has('registration') ? errors?.registration ?? undefined : undefined} />
              <FormField label="Pulsit Device ID"    name="pulsit_device_id"    value={form.pulsit_device_id}    onChange={handleFieldChange} error={touched.has('pulsit_device_id') ? errors?.pulsit_device_id ?? undefined : undefined} />
              <FormField label="VIN Number"          name="vin_number"          value={form.vin_number}          onChange={handleFieldChange} maxLength={VIN_LENGTH} helperText={vinFeedback?.hint ?? undefined} error={vinFeedback?.error ?? undefined} />
              <FormField label="Licence Disc Expiry" name="licence_disc_expiry" type="date" value={form.licence_disc_expiry} onChange={handleFieldChange} error={touched.has('licence_disc_expiry') ? errors?.licence_disc_expiry ?? undefined : undefined} />
              <FormField label="Make"  name="make"  value={form.make}  onChange={handleFieldChange} error={touched.has('make') ? errors?.make ?? undefined : undefined} />
              <FormField label="Model" name="model" value={form.model} onChange={handleFieldChange} error={touched.has('model') ? errors?.model ?? undefined : undefined} />
              <FormField label="Year"     name="year"                   type="number" inputMode="numeric" value={form.year}                  onChange={handleFieldChange} error={touched.has('year') ? errors?.year ?? undefined : undefined} />
              <FormField label="GVM (kg)" name="gross_vehicle_mass_kg" type="number" inputMode="numeric" value={form.gross_vehicle_mass_kg} onChange={handleFieldChange} error={touched.has('gross_vehicle_mass_kg') ? errors?.gross_vehicle_mass_kg ?? undefined : undefined} />

              {vehicle.vehicle_type === 'trailer' && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-surface-on-variant">Trailer Length</span>
                  <select
                    value={form.length_m}
                    onChange={(e) => setForm((prev) => prev ? { ...prev, length_m: e.target.value } : prev)}
                    className="border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest text-surface-on focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Not set</option>
                    <option value="6">6 m</option>
                    <option value="12">12 m</option>
                    <option value="18">18 m</option>
                  </select>
                </label>
              )}

              <div className="flex items-center justify-between py-[6px]">
                <span className="text-xs font-medium text-surface-on-variant">Active</span>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(next) => setForm((prev) => prev ? { ...prev, is_active: next } : prev)}
                  ariaLabel="Vehicle active"
                />
              </div>

              {saveError && <p className="text-sm text-red-500">{saveError}</p>}

              <div className="flex gap-[6px]">
                <Button full loading={saving} disabled={hasErrors || saving} onClick={handleSave}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-surf-lowest rounded-lg p-[12px_14px] mb-4 shadow-level-2">
              <InfoRow label="Registration"        value={vehicle.registration} mono />
              <InfoRow label="Type"                value={typeLabel} />
              {vehicle.make  && <InfoRow label="Make"  value={vehicle.make} />}
              {vehicle.model && <InfoRow label="Model" value={vehicle.model} />}
              {vehicle.year  && <InfoRow label="Year"  value={String(vehicle.year)} mono />}
              <InfoRow label="Pulsit device"       value={vehicle.pulsit_device_id} mono />
              <InfoRow label="VIN"                 value={vehicle.vin_number ?? '—'} mono={!!vehicle.vin_number} />
              <InfoRow label="Licence disc expiry" value={vehicle.licence_disc_expiry ?? '—'} mono={!!vehicle.licence_disc_expiry} />
              <InfoRow label="GVM"                 value={vehicle.gross_vehicle_mass_kg != null ? `${vehicle.gross_vehicle_mass_kg.toLocaleString()} kg` : '—'} mono={vehicle.gross_vehicle_mass_kg != null} />
              {vehicle.vehicle_type === 'trailer' && (
                <InfoRow label="Length" value={vehicle.length_m != null ? `${vehicle.length_m} m` : '—'} mono={vehicle.length_m != null} />
              )}
              <InfoRow label="Status"              value={vehicle.is_active ? 'Active' : 'Inactive'} />
            </div>
          )}

          {/* Blockchain — forensic detail; hidden for non-admin / forensic-off dispatchers. */}
          <ForensicOnly>
            <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
              Blockchain
            </div>
            <div className="bg-chain-c rounded-md p-[10px_12px] mb-4 leading-relaxed">
              <div className="flex items-center gap-[5px] mb-1">
                <Ic n="hex" s={12} className="text-chain" />
                <span className="text-[11px] font-[500] tracking-[0.04em] text-chain-onc">
                  {vehicle.receipts.length === 0
                    ? 'Not yet anchored'
                    : `${vehicle.receipts.length} receipt${vehicle.receipts.length > 1 ? 's' : ''} anchored`
                  }
                </span>
              </div>
              {latestReceipt && (
                <div className="mb-[6px]">
                  <BlockchainBadge receipt={latestReceipt} />
                </div>
              )}
              {vehicle.receipts.length === 0 && (
                <div className="text-[11px] text-chain-onc opacity-60">
                  Receipts are created when a vehicle is registered or updated.
                </div>
              )}
            </div>
          </ForensicOnly>

          {/* Trips */}
          {vehicle.trip_ids.length > 0 && (
            <>
              <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
                Trips Using This Vehicle
              </div>
              <div className="bg-surf-lowest rounded-lg shadow-level-2 divide-y divide-outline-v/20">
                {vehicle.trip_ids.map((tid) => (
                  <button
                    key={tid}
                    onClick={() => router.push(`/trips/${tid}`)}
                    className="w-full flex items-center justify-between px-[14px] py-[10px] text-left hover:bg-surf-low transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className="text-[13px] font-[500] tabular-nums tracking-[0.04em] text-sec truncate">{tid}</span>
                    <Ic n="chev" s={14} className="text-on-surf-v shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}

        </div>

        {/* RIGHT — scrollable immutable history, takes remaining space */}
        <div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Immutable History
          </div>
          <EventTimeline events={vehicle.events} receipts={vehicle.receipts} />
        </div>
      </div>
    </div>
  )
}
