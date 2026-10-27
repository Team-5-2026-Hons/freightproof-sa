'use client'

import { useContext, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import type {
  DriverSubstitutionContextRead,
  SubstitutionConfirmationDetail,
  SubstitutionRole,
  SubstitutionSealCondition,
  VehicleRef,
} from '@shared/lib/types/driver-substitution'
import {
  sealExpectation,
  useSubstitutionCapture,
  type CaptureSendOutcome,
  type SealExpectation,
} from '@/lib/hooks/useSubstitutionCapture'
import { useDriverSubstitutions } from '@/lib/hooks/useDriverSubstitutions'
import { TripContext } from '@/lib/context/TripContext'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import type { CaptureSealCheck, SubstitutionCapture } from '@/lib/offline/substitution-store'
import {
  blockerMessage,
  counterpartOf,
  identityLabel,
  substitutionStatusLine,
} from '@/lib/utils/driver-substitution'
import { formatDateTime } from '@/lib/utils/format-time'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { TextArea } from '@/components/ui/TextArea'
import { cn } from '@/lib/utils'

export interface DriverSubstitutionFlowProps {
  tripId: string
  requestId: string
  actorId: string
}

function notApplicableLabel(expectation: SealExpectation): string {
  return expectation === 'none-yet' || expectation === 'possible' ? 'No seal yet' : 'No seal (empty leg)'
}

function conditionOptions(expectation: SealExpectation): ReadonlyArray<{ value: SubstitutionSealCondition; label: string }> {
  return [
    { value: 'intact', label: 'Intact' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'missing', label: 'Missing' },
    { value: 'not_applicable', label: notApplicableLabel(expectation) },
  ]
}

const SEAL_LABEL: Record<SubstitutionSealCondition, string> = {
  intact: 'Seal intact',
  damaged: 'Seal damaged',
  missing: 'Seal missing',
  not_applicable: 'No seal',
}

const SEAL_EXPECTATION_NOTICE: Partial<Record<SealExpectation, { title: string; body: string }>> = {
  'none-yet': {
    title: 'No seal to check yet',
    body: 'This trip has not departed, so no seal has been applied. Each vehicle is recorded as having no seal yet. If you do find one, record it instead.',
  },
  possible: {
    title: 'Departure is still open',
    body: 'The seal is applied during departure. Record the seal if one is already on; otherwise choose “No seal yet”.',
  },
}

function roleNoun(role: SubstitutionRole): string {
  return role === 'outgoing' ? 'handover check' : 'takeover check'
}

function registrationOf(vehicles: readonly VehicleRef[], vehicleId: string): string {
  return vehicles.find((vehicle) => vehicle.id === vehicleId)?.registration ?? 'Vehicle'
}

/** A declaration the server already holds. Read-only: it can be compared, never resubmitted. */
function DeclarationSummary({
  title,
  declaration,
  vehicles,
}: {
  title: string
  declaration: SubstitutionConfirmationDetail
  vehicles: readonly VehicleRef[]
}) {
  return (
    <section aria-label={title} className="rounded-[22px] bg-fill px-4 py-3">
      <p className="text-headline text-surface-on">{title}</p>
      <p className="text-subhead text-surface-on-variant">
        Captured {formatDateTime(declaration.captured_at)} · received {formatDateTime(declaration.received_at)}
      </p>
      <ul className="mt-1 text-subhead text-surface-on">
        {declaration.seal_checks.map((check) => (
          <li key={check.vehicle_id}>
            {registrationOf(vehicles, check.vehicle_id)}: {SEAL_LABEL[check.condition]}
            {check.seal_number !== null && ` · ${check.seal_number}`}
            {check.not_applicable_reason !== null && ` · ${check.not_applicable_reason}`}
          </li>
        ))}
      </ul>
      {declaration.discrepancy_note !== null && (
        <p className="mt-1 text-subhead text-surface-on">Note: {declaration.discrepancy_note}</p>
      )}
    </section>
  )
}

interface SealCheckFieldsProps {
  check: CaptureSealCheck
  registration: string
  expectation: SealExpectation
  disabled: boolean
  onChange: (patch: Partial<Omit<CaptureSealCheck, 'vehicleId' | 'photos'>>) => void
  onAddPhoto: (dataUrl: string) => void
  onRemovePhoto: (photoId: string) => void
}

function SealCheckFields({ check, registration, expectation, disabled, onChange, onAddPhoto, onRemovePhoto }: SealCheckFieldsProps) {
  const needsNumber = check.condition === 'intact' || check.condition === 'damaged'
  const photoLabel = check.condition === 'missing' ? `Where the seal should be on ${registration}` : `Seal on ${registration}`
  const noSealHint = expectation === 'none-yet' || expectation === 'possible'
    ? 'Optional: no seal has been applied yet.'
    : 'Optional for an empty leg.'
  return (
    <fieldset className="flex flex-col gap-3 rounded-[22px] bg-fill px-4 py-3" disabled={disabled}>
      <legend className="text-headline text-surface-on">{registration}</legend>
      <div role="radiogroup" aria-label={`Seal on ${registration}`} className="flex flex-wrap gap-2">
        {conditionOptions(expectation).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={check.condition === option.value}
            onClick={() => onChange({ condition: option.value })}
            className={cn(
              'min-h-11 rounded-full px-4 text-subhead font-semibold',
              check.condition === option.value ? 'bg-primary text-primary-on' : 'bg-surface text-surface-on',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {needsNumber && (
        <Input
          label="Seal number"
          helperText="Two letters, a dash, four digits."
          value={check.sealNumber}
          autoCapitalize="characters"
          onChange={(event) => onChange({ sealNumber: event.target.value })}
        />
      )}
      {check.condition === 'not_applicable' && (
        <TextArea
          label={`Why ${registration} has no seal`}
          value={check.notApplicableReason}
          maxLength={1000}
          onChange={(event) => onChange({ notApplicableReason: event.target.value })}
        />
      )}
      {check.condition !== null && (
        <div className="flex flex-col gap-2">
          {check.photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {check.photos.map((photo) => (
                <li key={photo.id} className="relative aspect-square overflow-hidden rounded-xl bg-surface">
                  {photo.dataUrl !== '' && (
                    // eslint-disable-next-line @next/next/no-img-element -- static export: next/image optimisation is unavailable
                    <img src={photo.dataUrl} alt={`${photoLabel}, taken ${formatDateTime(photo.capturedAt)}`} className="h-full w-full object-cover" />
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => onRemovePhoto(photo.id)}
                      aria-label="Remove this photo"
                      className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full bg-surface/80"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!disabled && (
            <CameraCapture
              label={photoLabel}
              actionLabel={check.photos.length === 0 ? 'Take photo' : 'Add another photo'}
              hint={check.condition === 'not_applicable' ? noSealHint : undefined}
              variant={check.photos.length === 0 ? 'tile' : 'row'}
              dataUrl={null}
              onCapture={onAddPhoto}
            />
          )}
        </div>
      )}
    </fieldset>
  )
}

function CaptureForm({
  context,
  capture,
  role,
  state,
}: {
  context: DriverSubstitutionContextRead
  capture: SubstitutionCapture
  role: SubstitutionRole
  state: ReturnType<typeof useSubstitutionCapture>
}) {
  const locked = capture.status !== 'draft' || state.isSending
  const expectation = sealExpectation(context)
  const sealNotice = SEAL_EXPECTATION_NOTICE[expectation]
  const toggleVehicle = (vehicleId: string) => {
    const ids = capture.confirmedVehicleIds
    state.update({ confirmedVehicleIds: ids.includes(vehicleId) ? ids.filter((id) => id !== vehicleId) : [...ids, vehicleId] })
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="substitution-vehicles">
        <SectionHeading id="substitution-vehicles" title="Vehicles" />
        <p className="px-5 text-subhead text-surface-on-variant">Tick each vehicle you have checked is here.</p>
        <ul className="mt-2 flex flex-col gap-2 px-4">
          {context.vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-[16px] bg-fill px-4 py-2 text-body text-surface-on">
                <input
                  type="checkbox"
                  className="size-5"
                  disabled={locked}
                  checked={capture.confirmedVehicleIds.includes(vehicle.id)}
                  onChange={() => toggleVehicle(vehicle.id)}
                />
                {vehicle.registration}
                <span className="text-subhead text-surface-on-variant">{vehicle.vehicle_type === 'horse' ? 'Truck' : 'Trailer'}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="substitution-seals" className="flex flex-col gap-3">
        <SectionHeading id="substitution-seals" title="Seals" />
        {sealNotice !== undefined && (
          <StatusBanner tone="neutral" title={sealNotice.title} className="mx-4">{sealNotice.body}</StatusBanner>
        )}
        <div className="flex flex-col gap-3 px-4">
          {capture.sealChecks.map((check) => (
            <SealCheckFields
              key={check.vehicleId}
              check={check}
              registration={registrationOf(context.vehicles, check.vehicleId)}
              expectation={expectation}
              disabled={locked}
              onChange={(patch) => state.updateSealCheck(check.vehicleId, patch)}
              onAddPhoto={(dataUrl) => state.addPhoto(check.vehicleId, dataUrl)}
              onRemovePhoto={(photoId) => state.removePhoto(check.vehicleId, photoId)}
            />
          ))}
        </div>
      </section>

      <div className="px-4">
        <TextArea
          label="Anything that does not match (optional)"
          value={capture.discrepancyNote}
          maxLength={1000}
          disabled={locked}
          onChange={(event) => state.update({ discrepancyNote: event.target.value })}
        />
        <p className="mt-2 text-footnote text-surface-on-variant">
          Your phone&rsquo;s position is recorded when you confirm. If it cannot get one, that is recorded as unavailable.
        </p>
      </div>

      {capture.status === 'draft' && (
        <div className="flex flex-col gap-2 px-4">
          {state.problems.length > 0 && (
            <ul className="text-subhead text-surface-on-variant">
              {state.problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
          <Button
            variant="primary"
            size="pill"
            disabled={state.problems.length > 0 || state.storageError}
            loading={state.isSending}
            onClick={() => void state.submit()}
          >
            Confirm {roleNoun(role)}
          </Button>
        </div>
      )}
    </div>
  )
}

function outcomeBanner(outcome: CaptureSendOutcome | null): { title: string; body: string } | null {
  if (outcome === null) return null
  switch (outcome.kind) {
    case 'waiting':
      return { title: 'Saved on this phone, not sent yet', body: 'It will be sent, unchanged, as soon as there is a connection.' }
    case 'version-changed':
    case 'not-pending':
    case 'rejected':
      return { title: 'Not accepted', body: outcome.note }
    case 'saved':
    case 'busy':
      return null
  }
}

/**
 * This driver records their OWN handover (outgoing) or takeover (incoming) check —
 * vehicles, seals, photos, a note — on their own device. Saved before it is sent; the server
 * decides whether custody moved. A pending answer is shown as saved-and-waiting with the real
 * reason, never as a failure, and a completed transfer is shown only after the server's state
 * has been re-read. No dispatcher controls, no new phase, no fresh identity check.
 */
export function DriverSubstitutionFlow({ tripId, requestId, actorId }: DriverSubstitutionFlowProps) {
  const state = useSubstitutionCapture(tripId, requestId, actorId)
  const substitutions = useDriverSubstitutions()
  const tripCtx = useContext(TripContext)
  const [lastOutcome, setLastOutcome] = useState<CaptureSendOutcome | null>(null)
  const [tripRefreshed, setTripRefreshed] = useState(false)

  const { context, capture, role, submitted } = state

  if (state.isLoading) return <p className="px-5 py-6 text-body text-surface-on-variant">Loading the handover…</p>
  if (context === null || role === null) {
    return (
      <StatusBanner tone="attention" title="Handover unavailable" className="mx-4 mt-4">
        {state.loadError ?? 'This handover could not be loaded.'}
      </StatusBanner>
    )
  }

  const counterpart = counterpartOf(context, role)
  const counterpartDeclaration = context.confirmations.find((confirmation) => confirmation.driver_id === counterpart.id) ?? null
  const result = capture?.result ?? null
  const completed = context.state === 'completed'
  const canConfirm = context.state === 'pending'
    && context.permitted_actions.includes(role === 'outgoing' ? 'confirm_outgoing' : 'confirm_incoming')

  const afterSend = async (outcome: CaptureSendOutcome | null) => {
    setLastOutcome(outcome)
    if (outcome?.kind !== 'saved') return
    await substitutions.refresh()
    if (outcome.result.state === 'completed') {
      if (role === 'outgoing') tripCtx?.noteTripHandedOver(tripId)
      await tripCtx?.refreshQuietly()
      setTripRefreshed(true)
    }
  }

  const banner = outcomeBanner(lastOutcome)

  return (
    <div className="flex flex-col gap-5 pb-8 pt-4">
      <section className="mx-4 rounded-[22px] bg-fill px-4 py-4" aria-label="Handover details">
        <p className="text-footnote font-semibold uppercase tracking-wide text-surface-on-variant">
          {role === 'incoming' ? 'You are taking over' : 'You are handing over'}
        </p>
        <p className="text-title-2 text-surface-on">{context.trip_reference}</p>
        <p className="mt-1 text-subhead text-surface-on">
          {context.exchange?.label ?? 'Immediate transfer'} · expected {context.expected_at ? formatDateTime(context.expected_at) : 'No planned exchange time'}
        </p>
        <p className="text-subhead text-surface-on">
          {role === 'incoming' ? 'Handing over' : 'Taking over'}: {counterpart.full_name}
        </p>
        <p className="mt-2 text-subhead text-surface-on-variant">
          {role === 'incoming' ? 'Your identity record: ' : 'Incoming driver identity: '}
          {identityLabel(context.identity.status)}
        </p>
      </section>

      <StatusBanner
        tone={completed ? 'success' : context.completion_blocked_by !== null ? 'attention' : 'neutral'}
        title={substitutionStatusLine(context, role)}
        className="mx-4"
        live
      >
        {context.state === 'pending' && context.completion_blocked_by !== null
          ? `Your check is saved. ${blockerMessage(context.completion_blocked_by)}`
          : completed
            ? role === 'outgoing'
              ? 'You are no longer the driver on this trip. Everything you recorded is kept in your record.'
              : 'You are now the driver on this trip.'
            : undefined}
      </StatusBanner>

      {banner !== null && <StatusBanner tone="attention" title={banner.title} className="mx-4" live>{banner.body}</StatusBanner>}
      {capture?.note && capture.status !== 'saved' && lastOutcome === null && (
        <StatusBanner tone="attention" title="Your check is kept" className="mx-4">{capture.note}</StatusBanner>
      )}
      {state.storageError && (
        <StatusBanner tone="attention" title="This phone could not save your check" className="mx-4">
          Free some space and try again. Nothing is sent until it is saved here first.
        </StatusBanner>
      )}

      {completed && (
        <div className="mx-4 flex flex-col gap-2">
          {role === 'outgoing' ? (
            <Button asChild variant="fill" size="pill"><Link href={tripDetailHref(tripId)}>View your record</Link></Button>
          ) : tripRefreshed || result === null ? (
            <Button asChild variant="primary" size="pill"><Link href={tripDetailHref(tripId)}>Open the trip</Link></Button>
          ) : (
            <p className="text-subhead text-surface-on-variant">Loading your trip…</p>
          )}
        </div>
      )}

      {submitted !== null && (
        <div className="mx-4">
          <DeclarationSummary title={`Your ${roleNoun(role)}`} declaration={submitted} vehicles={context.vehicles} />
        </div>
      )}
      {counterpartDeclaration !== null && (
        <div className="mx-4">
          <DeclarationSummary
            title={`${counterpart.full_name}’s check (for comparison only)`}
            declaration={counterpartDeclaration}
            vehicles={context.vehicles}
          />
        </div>
      )}

      {submitted === null && capture !== null && capture.status === 'retained' && (
        <StatusBanner tone="attention" title="Not used for this handover" className="mx-4">
          {capture.note ?? 'This arrangement is no longer open. Your check is kept on this phone.'}
        </StatusBanner>
      )}

      {submitted === null && capture !== null && capture.status === 'sending' && (
        <div className="mx-4 flex flex-col gap-2">
          <StatusBanner tone="neutral" title="Saved on this phone, not sent yet" live>
            Your {roleNoun(role)} is fixed as you confirmed it and will be sent unchanged.
          </StatusBanner>
          <Button variant="secondary" size="sm" loading={state.isSending} onClick={() => void state.retry().then(afterSend)}>
            Send now
          </Button>
        </div>
      )}

      {submitted === null && capture !== null && canConfirm && (capture.status === 'draft' || capture.status === 'sending') && (
        <CaptureForm
          context={context}
          capture={capture}
          role={role}
          state={{ ...state, submit: () => state.submit().then(async (outcome) => { await afterSend(outcome); return outcome }) }}
        />
      )}
    </div>
  )
}
