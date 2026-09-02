'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

import { TopBar } from '@/components/ui/TopBar'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Switch } from '@/components/ui/Switch'
import { GeofenceMap } from '@/components/map/GeofenceMap'
import { useToast } from '@/lib/hooks/useToast'
import { api } from '@/lib/api/client'
import { ROUTES } from '@/lib/constants/routes'
import type { Precinct } from '@shared/lib/types/precinct'
import {
  validatePrecinctForm,
  parseCoordinatePair,
  PRECINCT_FIELD_ORDER,
  type PrecinctField,
} from '@shared/lib/validation/precinct'
import {
  GEOFENCE_RADIUS_DEFAULT,
  GEOFENCE_RADIUS_MIN,
  GEOFENCE_RADIUS_MAX,
} from '@shared/lib/validation/constants'

// Johannesburg. Only ever the STARTING viewport for a brand-new precinct — the
// dispatcher's first click replaces it. Never submitted as-is: latitude and longitude
// start empty and are required, so an untouched map cannot be saved.
const DEFAULT_MAP_CENTRE = { latitude: -26.2041, longitude: 28.0473 }

// 5 dp ≈ 1 m — finer than any geofence decision, and finer than a click is accurate.
const CLICK_COORDINATE_PRECISION = 5

const RADIUS_SLIDER_STEP_METRES = 10

interface PrecinctFormState {
  name: string
  address: string
  latitude: string
  longitude: string
  geofence_radius_metres: string
  is_shared: boolean
}

// The text-input fields. `is_shared` is excluded because it is a boolean Switch, not a
// string input — this is what lets setField narrow to PrecinctField without a cast.
type PrecinctTextField = Exclude<keyof PrecinctFormState, 'is_shared'>

const EMPTY_FORM: PrecinctFormState = {
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  geofence_radius_metres: String(GEOFENCE_RADIUS_DEFAULT),
  is_shared: false,
}

function formFromPrecinct(precinct: Precinct): PrecinctFormState {
  return {
    name: precinct.name,
    address: precinct.address ?? '',
    latitude: String(precinct.latitude),
    longitude: String(precinct.longitude),
    geofence_radius_metres: String(precinct.geofence_radius_metres),
    is_shared: precinct.is_shared,
  }
}

/** Parse a coordinate field for the map, falling back to the default centre. */
function coordOr(value: string, fallback: number): number {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

interface PrecinctFormProps {
  /** Absent = create. Present = edit that precinct. */
  precinct?: Precinct
}

export function PrecinctForm({ precinct }: PrecinctFormProps): React.JSX.Element {
  const router = useRouter()
  const { notify } = useToast()
  const isEdit = precinct !== undefined

  const [form, setForm] = useState<PrecinctFormState>(
    precinct ? formFromPrecinct(precinct) : EMPTY_FORM,
  )
  const [touched, setTouched] = useState<Set<PrecinctField>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const errors = validatePrecinctForm(form)
  const hasErrors = Object.values(errors).some((e) => e !== null)

  const mapLat = coordOr(form.latitude, DEFAULT_MAP_CENTRE.latitude)
  const mapLng = coordOr(form.longitude, DEFAULT_MAP_CENTRE.longitude)
  // Deliberately NOT clamped: if the dispatcher types 9000, the map should draw a 9000 m
  // circle so the reason it is rejected is visible, rather than quietly showing a legal
  // one. The slider below is clamped separately, because a range input has no way to
  // represent a value outside its own bounds.
  const mapRadius = coordOr(form.geofence_radius_metres, GEOFENCE_RADIUS_DEFAULT)
  const sliderRadius = Math.min(GEOFENCE_RADIUS_MAX, Math.max(GEOFENCE_RADIUS_MIN, mapRadius))

  function setField(name: PrecinctTextField, value: string): void {
    setForm((prev) => ({ ...prev, [name]: value }))
    // Every text field is validated (address for length only), and PrecinctTextField is
    // exactly PrecinctField — excluding only the boolean Switch — so this narrows without
    // a cast and no field is left unable to surface its error.
    setTouched((prev) => new Set(prev).add(name))
  }

  /**
   * FormField's onChange, with one extra behaviour on the coordinate fields: pasting
   * "lat, lng" — what every maps app puts on the clipboard — fills BOTH fields.
   *
   * This is the deliberate replacement for address geocoding: a geocoder returns a
   * street centroid, which for a warehouse estate can sit hundreds of metres from the
   * gate. parseCoordinatePair returns null for anything that is not a complete in-range
   * pair, so ordinary single-number typing is never interfered with.
   */
  function handleFieldChange(name: string, value: string): void {
    if (name === 'latitude' || name === 'longitude') {
      const pair = parseCoordinatePair(value)
      if (pair !== null) {
        setForm((prev) => ({ ...prev, latitude: pair.lat, longitude: pair.lng }))
        setTouched((prev) => new Set(prev).add('latitude').add('longitude'))
        return
      }
    }
    // FormField hands back the `name` prop this component gave it, so the value is
    // always one of ours — but it is typed as a bare string, so it is checked rather
    // than asserted.
    if (name in EMPTY_FORM && name !== 'is_shared') {
      setField(name as PrecinctTextField, value)
    }
  }

  function handleMapPosition(next: { latitude: number; longitude: number }): void {
    setForm((prev) => ({
      ...prev,
      latitude: next.latitude.toFixed(CLICK_COORDINATE_PRECISION),
      longitude: next.longitude.toFixed(CLICK_COORDINATE_PRECISION),
    }))
    setTouched((prev) => new Set(prev).add('latitude').add('longitude'))
  }

  async function handleSubmit(): Promise<void> {
    if (hasErrors) {
      setTouched(new Set(PRECINCT_FIELD_ORDER))
      const firstInvalid = PRECINCT_FIELD_ORDER.find((f) => errors[f] !== null)
      if (firstInvalid) {
        document.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus()
      }
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      const body = {
        name: form.name,
        address: form.address || null,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        geofence_radius_metres: parseInt(form.geofence_radius_metres, 10),
        is_shared: form.is_shared,
      }

      if (isEdit) {
        await api.patch(`/api/v1/precincts/${precinct.id}`, body)
        notify({ kind: 'success', title: 'Precinct updated', body: form.name })
        router.push(ROUTES.precinctDetail(String(precinct.id)))
      } else {
        const created = await api.post<Precinct>('/api/v1/precincts', body)
        notify({ kind: 'success', title: 'Precinct created', body: form.name })
        router.push(ROUTES.precinctDetail(String(created.id)))
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} precinct`,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title={isEdit ? 'Edit Precinct' : 'Add Precinct'}>
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          Cancel
        </Button>
        {/* One gradient CTA per view — DESIGN_SYSTEM 10.5.
            Enabled even while invalid, and deliberately so: a create form opens with
            latitude and longitude empty, so disabling on `hasErrors` would render a
            permanently dead button next to fields that show no errors yet (nothing is
            touched). Clicking runs handleSubmit's invalid branch instead, which marks
            every field touched and focuses the first offender — telling the dispatcher
            what is wrong rather than leaving them to guess. */}
        <Button size="sm" loading={submitting} disabled={submitting} onClick={handleSubmit}>
          {isEdit ? 'Save Changes' : 'Save Precinct'}
        </Button>
      </TopBar>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="w-full lg:w-[380px] shrink-0 overflow-y-auto p-6 flex flex-col gap-4 border-r border-outline-v/30">
          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <FormField
            label="Name"
            name="name"
            value={form.name}
            onChange={handleFieldChange}
            placeholder="FedEx DBN — Riverhorse Valley"
            required
            error={touched.has('name') ? errors.name ?? undefined : undefined}
          />
          <FormField
            label="Address"
            name="address"
            value={form.address}
            onChange={handleFieldChange}
            placeholder="12 Sookhai Place, Riverhorse Valley, Durban"
            helperText="A label for people. Nothing is computed from it."
            error={touched.has('address') ? errors.address ?? undefined : undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Latitude"
              name="latitude"
              inputMode="decimal"
              value={form.latitude}
              onChange={handleFieldChange}
              placeholder="-29.79420"
              required
              error={touched.has('latitude') ? errors.latitude ?? undefined : undefined}
            />
            <FormField
              label="Longitude"
              name="longitude"
              inputMode="decimal"
              value={form.longitude}
              onChange={handleFieldChange}
              placeholder="30.98200"
              required
              error={touched.has('longitude') ? errors.longitude ?? undefined : undefined}
            />
          </div>
          <p className="text-[11px] text-on-surf-v -mt-2">
            Click the map to place the pin, or paste coordinates from a maps app —
            decimal (&ldquo;lat, lng&rdquo;) or degrees/minutes/seconds both work.
          </p>

          <div className="flex flex-col gap-2">
            <FormField
              label="Geofence radius (m)"
              name="geofence_radius_metres"
              type="number"
              inputMode="numeric"
              value={form.geofence_radius_metres}
              onChange={handleFieldChange}
              required
              helperText="How close a handshake must be to count as at this facility."
              error={
                touched.has('geofence_radius_metres')
                  ? errors.geofence_radius_metres ?? undefined
                  : undefined
              }
            />
            {/* Slider and number together: the slider grows the circle under your eye,
                the field keeps it exact and typeable. */}
            <input
              type="range"
              min={GEOFENCE_RADIUS_MIN}
              max={GEOFENCE_RADIUS_MAX}
              step={RADIUS_SLIDER_STEP_METRES}
              value={sliderRadius}
              onChange={(e) => setField('geofence_radius_metres', e.target.value)}
              aria-label="Geofence radius in metres"
              // accent-sec, not accent-[var(--sec)]: this codebase defines its palette in
              // tailwind.config.ts and has no CSS custom properties, so the var() form
              // resolves to nothing and the slider renders in the browser default colour.
              className="w-full accent-sec"
            />
            <div
              className="flex justify-between text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <span>{GEOFENCE_RADIUS_MIN} m</span>
              <span>{GEOFENCE_RADIUS_MAX} m</span>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 pt-2 border-t border-outline-v/30">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-surface-on-variant">
                Share with other organisations
              </span>
              <span className="text-[11px] text-on-surf-v">
                Lets other organisations select this precinct when creating a trip. They
                still cannot edit it.
              </span>
            </div>
            <Switch
              checked={form.is_shared}
              onCheckedChange={(next) => setForm((prev) => ({ ...prev, is_shared: next }))}
              ariaLabel="Share this precinct with other organisations"
            />
          </div>
        </div>

        <div className="flex-1 min-h-[320px] p-6">
          <GeofenceMap
            latitude={mapLat}
            longitude={mapLng}
            radiusMetres={mapRadius}
            onPositionChange={handleMapPosition}
            className="w-full h-full min-h-[320px]"
          />
        </div>
      </div>
    </div>
  )
}
