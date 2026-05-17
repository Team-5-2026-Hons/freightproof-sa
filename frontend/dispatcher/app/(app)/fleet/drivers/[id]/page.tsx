'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TopBar }  from '@/components/ui/TopBar'
import { Chip }    from '@/components/ui/Chip'
import { Spinner } from '@/components/ui/Spinner'
import { Button }  from '@/components/ui/Button'
import { Ic }      from '@/components/ui/Ic'
import { InfoRow }   from '@/components/ui/InfoRow'
import { FormField } from '@/components/ui/FormField'
import { BlockchainBadge } from '@/components/blockchain/BlockchainBadge'
import { EventTimeline }   from '@/components/blockchain/EventTimeline'
import { useDriverDetail }  from '@/lib/hooks/useDriverDetail'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'

type EditState = {
  full_name: string
  phone_number: string
  license_number: string
  license_expiry: string
  is_active: boolean
}


export default function DriverDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { data: driver, isLoading, error, refetch } = useDriverDetail(params.id)

  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const backButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => router.push(ROUTES.fleetDrivers)}
      iconLeft={<Ic n="back" s={14} className="text-on-surf" />}
    >
      Back
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Driver" left={backButton} />
        <div className="flex items-center justify-center flex-1">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error || !driver) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar title="Driver not found" left={backButton} />
        <div className="p-6 text-[13px] text-on-surf-v">Could not load driver.</div>
      </div>
    )
  }

  const latestReceipt = driver.receipts[0] ?? null

  function startEdit() {
    setForm({
      full_name: driver!.full_name,
      phone_number: driver!.phone_number,
      license_number: driver!.license_number,
      license_expiry: driver!.license_expiry ?? '',
      is_active: driver!.is_active,
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
      if (form.full_name !== driver!.full_name) body.full_name = form.full_name
      if (form.phone_number !== driver!.phone_number) body.phone_number = form.phone_number
      if (form.license_number !== driver!.license_number) body.license_number = form.license_number
      if (form.license_expiry !== (driver!.license_expiry ?? '')) body.license_expiry = form.license_expiry || null
      if (form.is_active !== driver!.is_active) body.is_active = form.is_active

      if (Object.keys(body).length === 0) { setIsEditing(false); return }
      await api.patch(`/api/v1/drivers/${driver!.id}`, body)
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
        title={driver.full_name}
        sub={driver.phone_number}
        left={backButton}
      >
        <Chip type={driver.is_active ? 'complete' : 'pending'} label={driver.is_active ? 'Active' : 'Inactive'} />
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
          <EventTimeline events={driver.events} receipts={driver.receipts} />
        </div>

        {/* RIGHT — fixed 450px info column */}
        <div className="w-[450px] shrink-0 overflow-y-auto bg-surf-low border-l border-outline-v/20 p-5">

          {/* Driver info */}
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Driver Info
          </div>

          {isEditing && form ? (
            <div className="flex flex-col gap-3 mb-4">
              <FormField label="Full Name"      name="full_name"      value={form.full_name}      onChange={handleFieldChange} />
              <FormField label="Phone Number"   name="phone_number"   value={form.phone_number}   onChange={handleFieldChange} />
              <FormField label="Licence Number" name="license_number" value={form.license_number} onChange={handleFieldChange} />
              <FormField label="Licence Expiry" name="license_expiry" type="date" value={form.license_expiry} onChange={handleFieldChange} />

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

              <div className="flex items-center gap-[5px]">
                <Ic n="shield" s={11} className="text-on-surf-v opacity-50 shrink-0" />
                <span className="text-[10px] font-[500] tracking-[0.03em] text-on-surf-v opacity-60">
                  Licence number changes are SHA-256 hashed before anchoring to Hedera (POPIA).
                </span>
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
            <>
              <div className="bg-surf-lowest rounded-lg p-[12px_14px] mb-4 shadow-level-2">
                <InfoRow label="Full name"      value={driver.full_name} />
                <InfoRow label="Phone"          value={driver.phone_number} mono />
                <InfoRow label="ID number"      value={driver.id_number} mono />
                <InfoRow label="Licence number" value={driver.license_number} mono />
                <InfoRow label="Licence expiry" value={driver.license_expiry ?? '—'} mono={!!driver.license_expiry} />
                <InfoRow label="Status"         value={driver.is_active ? 'Active' : 'Inactive'} />
              </div>
              <div className="flex items-center gap-[5px] mb-4 px-[2px]">
                <Ic n="shield" s={11} className="text-on-surf-v opacity-50 shrink-0" />
                <span className="text-[10px] font-[500] tracking-[0.03em] text-on-surf-v opacity-60">
                  Personal info is stored in database only and never written to Hedera (POPIA).
                </span>
              </div>
            </>
          )}

          {/* Blockchain */}
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Blockchain
          </div>
          <div className="bg-chain-c rounded-md p-[10px_12px] mb-4 leading-relaxed">
            <div className="flex items-center gap-[5px] mb-1">
              <Ic n="hex" s={12} className="text-chain" />
              <span className="text-[11px] font-[500] tracking-[0.04em] text-chain-onc">
                {driver.receipts.length === 0
                  ? 'Not yet anchored'
                  : `${driver.receipts.length} receipt${driver.receipts.length > 1 ? 's' : ''} anchored`
                }
              </span>
            </div>
            {latestReceipt && (
              <div className="mb-[6px]">
                <BlockchainBadge receipt={latestReceipt} />
              </div>
            )}
            <div className="text-[11px] text-chain-onc opacity-60">
              Licence number is SHA-256 hashed before anchoring.
            </div>
          </div>

          {/* Trips */}
          {driver.trip_ids.length > 0 && (
            <>
              <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
                Trips for This Driver
              </div>
              <div className="bg-surf-lowest rounded-lg shadow-level-2 divide-y divide-outline-v/20">
                {driver.trip_ids.map((tid) => (
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
