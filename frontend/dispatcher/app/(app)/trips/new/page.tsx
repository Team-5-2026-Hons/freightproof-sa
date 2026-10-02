'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui/TopBar'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Ic } from '@/components/ui/Ic'
import { RecordLink } from '@/components/ui/RecordLink'
import { CardTitle, FormCard } from '@/components/trips/new/form-parts'
import { ManifestLookup } from '@/components/trips/new/ManifestLookup'
import { ManifestSummary } from '@/components/trips/new/ManifestSummary'
import { ManifestWarnings } from '@/components/trips/new/ManifestWarnings'
import { RouteFields, type RouteEnd } from '@/components/trips/new/RouteFields'
import { ScheduleFields } from '@/components/trips/new/ScheduleFields'
import { CrewFields } from '@/components/trips/new/CrewFields'
import { CreateTripSummary, type SummaryRow } from '@/components/trips/new/CreateTripSummary'
import { createTrip, createTripFromPPManifest, findLiveTripForManifest } from '@/lib/api/client'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { useManifestPreview } from '@/lib/hooks/useManifestPreview'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useToast } from '@/lib/hooks/useToast'
import { useVehicles } from '@/lib/hooks/useVehicles'
import { ROUTES } from '@/lib/constants/routes'
import { fmtManifestCargo } from '@/lib/format/manifest'
import {
  EMPTY_CREW, NO_OVERRIDES, NO_PICKS, NO_TIMES,
  buildEmptyLegPayload, buildFromManifestPayload, localInputToIso, manifestTimes, parseManifestNumber,
  shownTimes, validateCrew, validateEmptyLegRoute, validateManifestRoute, validateSchedule,
  type CrewValues, type FieldErrors, type RoutePicks, type ScheduleOverrides,
} from '@/lib/trips/manifest-form'
import { classifyCreateError } from '@/lib/trips/trip-api-errors'
import { trailerCombo } from '@/lib/trips/trailer-combo'
import { COPY } from '@shared/lib/constants/copy'
import { cn } from '@shared/lib/utils/cn'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { PPManifestHub, PPManifestPreview } from '@shared/lib/types/pp-manifest'
import type { Vehicle } from '@shared/lib/types/vehicle'

type CreateMode = 'manifest' | 'empty_leg'

const MODE_TABS = [
  { id: 'manifest', label: 'From manifest' },
  { id: 'empty_leg', label: 'Empty leg (no manifest)' },
] as const

const PANEL_ID = 'create-trip-panel'

const BAD_NUMBER = 'Enter the manifest number using digits only, e.g. 81.'
const FIELDS_INCOMPLETE = 'Complete the highlighted fields before creating the trip.'
const MANIFEST_CHANGED_NOTE =
  'The manifest changed since you looked it up. Check the updated summary, then create the trip again.'
const TIMEOUT_NOT_CREATED =
  'The server took too long to respond, and no trip was created for this manifest. Try again.'
const TIMEOUT_UNCONFIRMED =
  'The server took too long to respond, and the check for the trip failed too. Trying again is safe: a manifest can only be on one trip.'
const TIMEOUT_EMPTY_LEG =
  'The server took too long to respond, so it is not known whether the empty leg was created. Check Active trips before trying again: empty legs have no duplicate check.'
const NOT_SET = 'Not set'
const CTA_HINT_NO_MANIFEST = 'Look up a manifest first.'
const CTA_HINT_BLOCKED = 'This manifest cannot become a trip.'

/** What a failed create left the dispatcher to read, or to open. */
interface Notice {
  tone: 'error' | 'warn'
  message: string
  /** The trip already holding this manifest, when it is ours to open. */
  trip?: { id: string; reference: string | null }
  /** An empty-leg timeout: Active trips is where to check. */
  showActiveTrips?: boolean
}

export default function TripNewPage(): React.JSX.Element {
  const router = useRouter()
  const { notify } = useToast()
  const { drivers } = useDrivers()
  const { horses, trailers } = useVehicles()
  const { precincts, error: precinctsError } = usePrecincts()
  const lookup = useManifestPreview()

  const [mode, setMode] = useState<CreateMode>('manifest')
  const [manifestInput, setManifestInput] = useState('')
  const [manifestInputError, setManifestInputError] = useState<string | null>(null)
  const [crew, setCrew] = useState<CrewValues>(EMPTY_CREW)
  const [overrides, setOverrides] = useState<ScheduleOverrides>(NO_OVERRIDES)
  const [picks, setPicks] = useState<RoutePicks>(NO_PICKS)
  const [showErrors, setShowErrors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Bumped on every refused Create, so the same first error is refocused on a second press.
  const [refusedAttempts, setRefusedAttempts] = useState(0)
  const noticeRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Without this the failure is invisible: the precinct pickers would just be empty.
  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Precincts cannot be selected until this loads.`,
      })
    }
  }, [precinctsError, notify])

  // A failed create is announced where the dispatcher's attention goes next.
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  // A refused Create takes the dispatcher to the first field to fix. The CTA sits in the
  // sticky summary, often a screen away from the field that blocked it.
  useEffect(() => {
    if (refusedAttempts === 0) return
    panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus()
  }, [refusedAttempts])

  const preview: PPManifestPreview | null = lookup.state.status === 'loaded' ? lookup.state.preview : null
  const source = mode === 'manifest' && preview ? manifestTimes(preview) : NO_TIMES
  const shown = shownTimes(overrides, source)
  const selectedTrailers = crew.trailerIds
    .map(id => trailers.find(t => t.id === id))
    .filter((t): t is Vehicle => t !== undefined)
  const combo = trailerCombo(selectedTrailers)
  // In manifest mode nothing else is asked for until the manifest can become a trip.
  const formReady = mode === 'empty_leg' || preview?.can_create === true

  let errors: FieldErrors = {}
  if (mode === 'empty_leg') {
    errors = { ...validateEmptyLegRoute(picks), ...validateSchedule(shown, source), ...validateCrew(crew, combo.valid) }
  } else if (preview) {
    errors = { ...validateManifestRoute(preview, picks), ...validateSchedule(shown, source), ...validateCrew(crew, combo.valid) }
  }
  const hasErrors = Object.keys(errors).length > 0
  const shownErrors: FieldErrors = showErrors ? errors : {}

  // Route, times and the review state belong to one manifest or one empty leg. Crew does
  // not, so it survives every reset.
  function resetEntries(): void {
    setOverrides(NO_OVERRIDES)
    setPicks(NO_PICKS)
    setShowErrors(false)
    setNotice(null)
  }

  function changeMode(next: string): void {
    if (next !== 'manifest' && next !== 'empty_leg') return
    setMode(next)
    resetEntries()
  }

  function changeManifestInput(value: string): void {
    setManifestInput(value)
    setManifestInputError(null)
    // The summary must always describe the number in the box: what is shown is what gets created.
    if (lookup.state.status !== 'idle') {
      lookup.reset()
      resetEntries()
    }
  }

  function lookUpManifest(): void {
    const manifestNumber = parseManifestNumber(manifestInput)
    if (manifestNumber === null) {
      setManifestInputError(BAD_NUMBER)
      return
    }
    resetEntries()
    void lookup.lookUp(manifestNumber)
  }

  function pickPrecinct(end: 'origin' | 'destination', precinctId: string): void {
    setPicks(current => (end === 'origin' ? { ...current, originId: precinctId } : { ...current, destinationId: precinctId }))
  }

  function attemptCreate(): void {
    if (hasErrors) {
      setShowErrors(true)
      setRefusedAttempts(count => count + 1)
      return
    }
    setConfirming(true)
  }

  function openCreated(tripId: string): void {
    notify({ kind: 'success', title: COPY.toast.tripCreated })
    router.push(ROUTES.tripDetail(tripId))
  }

  async function submitManifest(current: PPManifestPreview): Promise<void> {
    try {
      const trip = await createTripFromPPManifest(buildFromManifestPayload(current, crew, overrides, picks))
      openCreated(trip.id)
    } catch (err) {
      const failure = classifyCreateError(err)
      switch (failure.kind) {
        case 'no_response': {
          // Creation is atomic: the trip exists in full or not at all. One exact lookup
          // therefore turns "maybe" into a definite answer (spec §10.4).
          let existing: { id: string } | null
          try {
            existing = await findLiveTripForManifest(current.pp_manifest)
          } catch (lookupError) {
            console.warn('Trip lookup after a create timeout failed', lookupError)
            setNotice({ tone: 'error', message: TIMEOUT_UNCONFIRMED })
            return
          }
          // A trip found here may have been created by another dispatcher in the meantime;
          // spec §10.4 accepts that, since a manifest can only be on one trip.
          if (existing) openCreated(existing.id)
          else setNotice({ tone: 'error', message: TIMEOUT_NOT_CREATED })
          return
        }
        case 'manifest_changed':
          // Crew, picks and edited times stand. Untouched times are null overrides, so they
          // now follow the new manifest.
          lookup.replace(failure.preview)
          setNotice({ tone: 'warn', message: MANIFEST_CHANGED_NOTE })
          return
        case 'already_on_trip':
          setNotice({
            tone: 'error',
            message: failure.message,
            trip: failure.tripId ? { id: failure.tripId, reference: failure.tripReference } : undefined,
          })
          return
        case 'rejected':
          setNotice({ tone: 'error', message: failure.message })
      }
    }
  }

  async function submitEmptyLeg(): Promise<void> {
    try {
      const trip = await createTrip(buildEmptyLegPayload(crew, overrides, picks))
      openCreated(trip.id)
    } catch (err) {
      const failure = classifyCreateError(err)
      setNotice(
        failure.kind === 'no_response'
          ? { tone: 'error', message: TIMEOUT_EMPTY_LEG, showActiveTrips: true }
          : { tone: 'error', message: failure.message },
      )
    }
  }

  async function submit(): Promise<void> {
    setSubmitting(true)
    setNotice(null)
    try {
      if (mode === 'manifest' && preview) await submitManifest(preview)
      else if (mode === 'empty_leg') await submitEmptyLeg()
    } finally {
      setSubmitting(false)
      setConfirming(false)
    }
  }

  // ── Route ends and summary rows ─────────────────────────────────────────────
  const clientPrecincts = preview?.client_organization_id
    ? precincts.filter(p => p.principal_organization_id === preview.client_organization_id)
    : []

  function manifestEnd(hub: PPManifestHub, picked: string): RouteEnd {
    return hub.precinct_id
      ? { kind: 'fixed', name: hub.precinct_name ?? hub.hub_code, hubCode: hub.hub_code }
      : { kind: 'pick', value: picked, options: clientPrecincts, hubCode: hub.hub_code }
  }

  const precinctName = (id: string): string | null => precincts.find(p => p.id === id)?.name ?? null
  const originName = mode === 'manifest' && preview
    ? preview.origin.precinct_name ?? precinctName(picks.originId) ?? `Hub ${preview.origin.hub_code}`
    : precinctName(picks.originId)
  const destinationName = mode === 'manifest' && preview
    ? preview.destination.precinct_name ?? precinctName(picks.destinationId) ?? `Hub ${preview.destination.hub_code}`
    : precinctName(picks.destinationId)

  const rows: SummaryRow[] = [
    mode === 'manifest'
      ? { label: 'Manifest', value: preview?.pp_manifest.display ?? 'Not looked up', numeric: preview !== null }
      : { label: 'Manifest', value: 'Empty leg' },
    ...(mode === 'manifest' && preview ? [{ label: 'Client', value: preview.client_name }] : []),
    { label: 'Route', value: originName && destinationName ? `${originName} → ${destinationName}` : NOT_SET },
    { label: 'Departure', value: shown.departure ? fmtDateTime(localInputToIso(shown.departure)) : NOT_SET, numeric: Boolean(shown.departure) },
    { label: 'Arrival', value: shown.arrival ? fmtDateTime(localInputToIso(shown.arrival)) : NOT_SET, numeric: Boolean(shown.arrival) },
    { label: 'Driver', value: drivers.find(d => d.id === crew.driverId)?.full_name ?? NOT_SET },
    { label: 'Horse', value: horses.find(h => h.id === crew.horseId)?.registration ?? NOT_SET, numeric: Boolean(crew.horseId) },
    {
      label: 'Trailers',
      value: selectedTrailers.length ? selectedTrailers.map(t => t.registration).join(', ') : 'None',
      numeric: selectedTrailers.length > 0,
    },
    {
      label: 'Cargo',
      value: mode === 'empty_leg'
        ? 'None (empty leg)'
        : preview ? fmtManifestCargo(preview.totals, { withWeight: false }) : NOT_SET,
    },
  ]

  const manifestBlocked = mode === 'manifest' && preview !== null && !preview.can_create
  // Why the CTA is disabled, said in words: a greyed button alone explains nothing.
  const ctaHint = formReady
    ? null
    : manifestBlocked
      ? CTA_HINT_BLOCKED
      : CTA_HINT_NO_MANIFEST
  const crewStep = mode === 'manifest' ? 3 : 2

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Create Trip" sub={mode === 'manifest' ? 'From a client manifest' : 'Empty leg, no cargo'} />

      {/* relative: visually hidden labels (sr-only) are absolutely positioned. Without a
          positioned ancestor they escape this scroll box and lengthen the whole document,
          so the app shell scrolls away past the end of the form. */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {notice && <NoticeBanner notice={notice} ref={noticeRef} />}

            <Tabs tabs={MODE_TABS} active={mode} onChange={changeMode} panelId={PANEL_ID} ariaLabel="How to create this trip" />

            <div ref={panelRef} id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${mode}`} className="flex flex-col gap-5">
              {mode === 'manifest' ? (
                <>
                  <StepSection step={1} label="Find the manifest">
                    <FormCard>
                      <CardTitle icon="file">Client manifest</CardTitle>
                      <ManifestLookup
                        value={manifestInput}
                        onChange={changeManifestInput}
                        onLookUp={lookUpManifest}
                        state={lookup.state}
                        inputError={manifestInputError}
                        onEmptyLeg={() => changeMode('empty_leg')}
                      />
                      {preview && (
                        <div className="mt-5 flex flex-col gap-4 border-t border-outline-v/20 pt-5">
                          <ManifestWarnings warnings={preview.warnings} onEmptyLeg={() => changeMode('empty_leg')} />
                          <ManifestSummary preview={preview} />
                        </div>
                      )}
                    </FormCard>
                  </StepSection>

                  {preview?.can_create && (
                    <>
                      <StepSection step={2} label="Where and when">
                        <FormCard>
                          <CardTitle icon="map">Route &amp; schedule</CardTitle>
                          <RouteFields
                            origin={manifestEnd(preview.origin, picks.originId)}
                            destination={manifestEnd(preview.destination, picks.destinationId)}
                            onPick={pickPrecinct}
                            errors={shownErrors}
                          />
                          <ScheduleFields overrides={overrides} source={source} onChange={setOverrides} errors={shownErrors} />
                        </FormCard>
                      </StepSection>
                    </>
                  )}
                </>
              ) : (
                <StepSection step={1} label="Where and when">
                  <FormCard>
                    <CardTitle icon="map">Route &amp; schedule</CardTitle>
                    <RouteFields
                      origin={{ kind: 'pick', value: picks.originId, options: precincts, hubCode: null }}
                      destination={{ kind: 'pick', value: picks.destinationId, options: precincts, hubCode: null }}
                      onPick={pickPrecinct}
                      errors={shownErrors}
                    />
                    <ScheduleFields overrides={overrides} source={NO_TIMES} onChange={setOverrides} errors={shownErrors} />
                  </FormCard>
                </StepSection>
              )}

              {formReady && (
                <StepSection step={crewStep} label="Driver and vehicle">
                  <CrewFields
                    crew={crew}
                    onChange={setCrew}
                    drivers={drivers}
                    horses={horses}
                    trailers={trailers}
                    combo={combo}
                    errors={shownErrors}
                  />
                </StepSection>
              )}
            </div>
          </div>

          {/* On desktop the summary and its CTA stay in view while the form scrolls; below lg
              the column stacks and the summary follows the form. */}
          <div className="flex w-full shrink-0 flex-col gap-2 lg:sticky lg:top-6 lg:w-[280px]">
            <CreateTripSummary
              rows={rows}
              canCreate={formReady && !submitting}
              busy={submitting}
              errorText={showErrors && hasErrors ? FIELDS_INCOMPLETE : null}
              onCreate={attemptCreate}
              disabledHint={ctaHint}
            />
          </div>
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        closeDisabled={submitting}
        title="This action is permanent"
        footer={(
          <div className="flex w-full flex-col gap-2">
            <Button full loading={submitting} onClick={() => { void submit() }}>
              {submitting ? 'Creating trip…' : 'Yes, create and lock trip'}
            </Button>
            <Button variant="secondary" full onClick={() => setConfirming(false)} disabled={submitting}>
              Go back and review
            </Button>
          </div>
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-[2px] shrink-0 rounded-full bg-warn-c p-[6px]">
            <Ic n="lock" s={16} className="text-warn" />
          </div>
          <p className="text-[13px] leading-relaxed text-on-surf-v">
            Once created, this trip is anchored to the Hedera blockchain and cannot be deleted. A trip can
            only be cancelled, so its evidence is kept.
          </p>
        </div>
      </Modal>

      <div className="flex shrink-0 gap-[10px] border-t border-outline-v/20 bg-surf-lowest px-6 py-3">
        <Button variant="secondary" className="min-h-[44px]" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  )
}

/** React 19: `ref` is an ordinary prop. tabIndex -1 lets the page move focus here. */
function NoticeBanner({ notice, ref }: { notice: Notice; ref: React.Ref<HTMLDivElement> }): React.JSX.Element {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-sec',
        notice.tone === 'error' ? 'bg-err-c text-err-onc' : 'bg-warn-c text-warn-onc',
      )}
    >
      <Ic n="warn" s={16} className={cn('mt-[1px]', notice.tone === 'error' ? 'text-err' : 'text-warn')} />
      <div className="min-w-0 text-[13px] font-[600] leading-relaxed">
        <p>{notice.message}</p>
        {notice.trip && (
          <RecordLink href={ROUTES.tripDetail(notice.trip.id)}>Open {notice.trip.reference ?? 'that trip'}</RecordLink>
        )}
        {notice.showActiveTrips && <RecordLink href={ROUTES.home}>Open Active trips</RecordLink>}
      </div>
    </div>
  )
}

/** A numbered section: the eyebrow shows the dispatcher where they are in the one screen. */
function StepSection(
  { step, label, children }: { step: number; label: string; children: React.ReactNode },
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 px-1 text-[11px] font-[700] uppercase tracking-[0.08em] text-on-surf-v">
        <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-sec-c text-[11px] tabular-nums text-sec">
          {step}
        </span>
        {label}
      </p>
      {children}
    </div>
  )
}
