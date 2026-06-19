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
import { BlockchainBadge } from '@/components/blockchain/BlockchainBadge'
import { EventTimeline }   from '@/components/blockchain/EventTimeline'
import { ForensicOnly }    from '@/components/blockchain/ForensicOnly'
import { useVehicleDetail } from '@/lib/hooks/useVehicleDetail'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'

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
  const { data: vehicle, isLoading, error, refetch } = useVehicleDetail(params.id)

  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
    setSaveError(null)
    setIsEditing(true)
  }

  function handleFieldChange(name: string, value: string) {
    setForm((prev) => prev ? { ...prev, [name]: value } : prev)
  }

  async function handleSave() {
    if (!form) return
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
      await refetch()
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
        {!isEditing && (
          <Button variant="secondary" size="sm" onClick={startEdit}>
            Edit
          </Button>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — scrollable immutable history */}
        <div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Immutable History
          </div>
          <EventTimeline events={vehicle.events} receipts={vehicle.receipts} />
        </div>

        {/* RIGHT — fixed 450px info column */}
        <div className="w-[450px] shrink-0 overflow-y-auto bg-surf-low border-l border-outline-v/20 p-5">

          {/* Vehicle info */}
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Vehicle Info
          </div>

          {isEditing && form ? (
            <div className="flex flex-col gap-3 mb-4">
              <FormField label="Registration"        name="registration"        value={form.registration}        onChange={handleFieldChange} />
              <FormField label="Pulsit Device ID"    name="pulsit_device_id"    value={form.pulsit_device_id}    onChange={handleFieldChange} />
              <FormField label="VIN Number"          name="vin_number"          value={form.vin_number}          onChange={handleFieldChange} />
              <FormField label="Licence Disc Expiry" name="licence_disc_expiry" type="date" value={form.licence_disc_expiry} onChange={handleFieldChange} />
              <FormField label="Make"  name="make"  value={form.make}  onChange={handleFieldChange} />
              <FormField label="Model" name="model" value={form.model} onChange={handleFieldChange} />
              <FormField label="Year"     name="year"                   type="number" value={form.year}                  onChange={handleFieldChange} />
              <FormField label="GVM (kg)" name="gross_vehicle_mass_kg" type="number" value={form.gross_vehicle_mass_kg} onChange={handleFieldChange} />

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
                <button
                  type="button"
                  onClick={() => setForm((prev) => prev ? { ...prev, is_active: !prev.is_active } : prev)}
                  className={`relative w-[40px] h-[22px] rounded-full transition-colors duration-200 ${form.is_active ? 'bg-ok' : 'bg-outline-v'}`}
                >
                  <span
                    className="absolute top-[3px] w-[16px] h-[16px] rounded-full bg-white shadow transition-all duration-200"
                    style={{ left: form.is_active ? '21px' : '3px' }}
                  />
                </button>
              </div>

              {saveError && <p className="text-sm text-red-500">{saveError}</p>}

              <div className="flex gap-[6px]">
                <Button full loading={saving} onClick={handleSave}>
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
      </div>
    </div>
  )
}
