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
import { useDriverDetail } from '@/lib/hooks/useDriverDetail'
import {
  useResizablePanel,
  DETAIL_PANEL_DEFAULT_W,
  DETAIL_PANEL_MIN_W,
  DETAIL_PANEL_MAX_W,
} from '@/lib/hooks/useResizablePanel'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'
import {
  validateDriverForm,
  phoneFieldFeedback,
  normalisePhone,
  DRIVER_FIELD_ORDER,
  type DriverField,
  type DriverFormValues,
} from '@shared/lib/validation/driver'
import { AdminOnly } from '@/components/auth/AdminOnly'

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
  const { data: driver, isLoading, error, refetchSilent } = useDriverDetail(params.id)

  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<EditState | null>(null)
  const [touched, setTouched] = useState<Set<DriverField>>(new Set())
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

  // Derived each render — validateDriverForm is pure and cheap. id_number is
  // immutable and never edited here, so the stored value is passed straight
  // through (always valid); its error never surfaces.
  const formValues: DriverFormValues | null = form
    ? {
        full_name: form.full_name,
        id_number: driver.id_number,
        phone_number: form.phone_number,
        license_number: form.license_number,
        license_expiry: form.license_expiry,
      }
    : null
  const errors = formValues ? validateDriverForm(formValues) : null
  const hasErrors = errors ? Object.values(errors).some((e) => e !== null) : false
  // Phone gets live feedback the moment the user types (not touched-gated), like VIN.
  const phoneFeedback = form ? phoneFieldFeedback(form.phone_number) : null

  function startEdit() {
    setForm({
      full_name: driver!.full_name,
      phone_number: driver!.phone_number,
      license_number: driver!.license_number,
      license_expiry: driver!.license_expiry ?? '',
      is_active: driver!.is_active,
    })
    setTouched(new Set())
    setSaveError(null)
    setIsEditing(true)
  }

  function handleFieldChange(name: string, value: string) {
    setForm((prev) => prev ? { ...prev, [name]: value } : prev)
    setTouched((prev) => {
      const next = new Set(prev)
      next.add(name as DriverField)
      return next
    })
  }

  async function handleSave() {
    if (!form) return

    // Defensive re-validate: the disabled Save button blocks this in the common
    // path, but guard here too (e.g. a future Enter-key submit).
    if (errors && hasErrors) {
      setTouched(new Set(DRIVER_FIELD_ORDER))
      const firstInvalidField = DRIVER_FIELD_ORDER.find((field) => errors[field] !== null)
      if (firstInvalidField) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalidField}"]`)?.focus()
      }
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const body: Record<string, unknown> = {}
      if (form.full_name !== driver!.full_name) body.full_name = form.full_name
      // Normalise before diffing so a re-typed local number that equals the
      // stored +27 form isn't sent as a spurious change.
      const normalisedPhone = normalisePhone(form.phone_number)
      if (normalisedPhone !== driver!.phone_number) body.phone_number = normalisedPhone
      if (form.license_number !== driver!.license_number) body.license_number = form.license_number
      if (form.license_expiry !== (driver!.license_expiry ?? '')) body.license_expiry = form.license_expiry || null
      if (form.is_active !== driver!.is_active) body.is_active = form.is_active

      if (Object.keys(body).length === 0) { setIsEditing(false); return }
      await api.patch(`/api/v1/drivers/${driver!.id}`, body)
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
        title={driver.full_name}
        sub={driver.phone_number}
        left={backButton}
      >
        <Chip type={driver.is_active ? 'complete' : 'pending'} label={driver.is_active ? 'Active' : 'Inactive'} />
      </TopBar>

      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — resizable driver info column, drag-to-resize */}
        <div
          style={{ width: panelWidth }}
          className="relative shrink-0 overflow-y-auto bg-surf-low border-r border-outline-v/20 p-5"
        >

          {/* Resize handle — hover to reveal, drag to resize */}
          <div
            onMouseDown={startResize}
            className="absolute top-0 right-0 -mr-2 h-full w-4 cursor-col-resize flex items-center justify-center group z-10"
          >
            <div className="w-[2px] h-10 rounded-full bg-outline-v/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Driver info */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v">
              Driver Info
            </div>
            <AdminOnly>
              {!isEditing && (
                <Button variant="secondary" size="sm" onClick={startEdit}>
                  Edit
                </Button>
              )}
            </AdminOnly>
          </div>

          {isEditing && form ? (
            <div className="flex flex-col gap-3 mb-4">
              <FormField label="Full Name"      name="full_name"      value={form.full_name}      onChange={handleFieldChange} error={touched.has('full_name') ? errors?.full_name ?? undefined : undefined} />
              <FormField label="Phone Number"   name="phone_number"   value={form.phone_number}   onChange={handleFieldChange} helperText={phoneFeedback?.hint ?? undefined} error={phoneFeedback?.error ?? (touched.has('phone_number') ? errors?.phone_number ?? undefined : undefined)} />
              <FormField label="Licence Number" name="license_number" value={form.license_number} onChange={handleFieldChange} error={touched.has('license_number') ? errors?.license_number ?? undefined : undefined} />
              <FormField label="Licence Expiry" name="license_expiry" type="date" value={form.license_expiry} onChange={handleFieldChange} error={touched.has('license_expiry') ? errors?.license_expiry ?? undefined : undefined} />

              <div className="flex items-center justify-between py-[6px]">
                <span className="text-xs font-medium text-surface-on-variant">Active</span>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(next) => setForm((prev) => prev ? { ...prev, is_active: next } : prev)}
                  ariaLabel="Driver active"
                />
              </div>

              <div className="flex items-center gap-[5px]">
                <Ic n="shield" s={11} className="text-on-surf-v opacity-50 shrink-0" />
                <span className="text-[10px] font-[500] tracking-[0.03em] text-on-surf-v opacity-60">
                  Licence number changes are SHA-256 hashed before anchoring to Hedera (POPIA).
                </span>
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

          {/* Blockchain — forensic detail; hidden for non-admin / forensic-off dispatchers. */}
          <ForensicOnly>
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
          </ForensicOnly>

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

        {/* RIGHT — scrollable immutable history, takes remaining space */}
        <div className="flex-1 overflow-y-auto p-6 bg-surf-lowest">
          <div className="text-[11px] font-[700] tracking-[0.1em] uppercase text-on-surf-v mb-3">
            Immutable History
          </div>
          <EventTimeline events={driver.events} receipts={driver.receipts} />
        </div>
      </div>
    </div>
  )
}
