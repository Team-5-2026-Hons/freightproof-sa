import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripTimeline } from '@/components/trips/TripTimeline'
import { line } from '@/components/domain/__tests__/textLine'
import { EXCEPTION_ROW_CAP } from '@/lib/phase/exception-rows'
import {
  FIXTURE_IMAGES, FIXTURE_LONG_DESCRIPTION_LENGTH, SCENARIO_IDS, artifactsByIdOf, buildScenarios,
  type ScenarioId, type TimelineScenario,
} from './phase-acts'

// PhaseOverrideAction imports lib/api/client -> lib/supabase/client, which calls createClient()
// at import time and throws without a real Supabase URL.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicOnly is gated on a real provider (itself gated on useAuth); the gate is what the
// scenarios exercise, so its two inputs are set directly.
const forensic = vi.hoisted(() => ({ canViewForensics: true, forensicOn: false, toggle: vi.fn() }))
vi.mock('@/lib/context/ForensicModeContext', () => ({ useForensicMode: () => forensic }))
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-me' } }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/components/map/LocationComparisonMap', () => ({ LocationComparisonMap: () => null }))
vi.mock('@/components/blockchain/VerifyButton', () => ({
  VerifyButton: ({ subjectId, ariaLabel }: { subjectId: string; ariaLabel?: string }) => (
    <button type="button" aria-label={ariaLabel}>{subjectId}</button>
  ),
}))

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public')
const PUBLIC_IMAGE_PREFIX = '/dev-fixtures/'
// The one scenario whose point is that the page cannot resolve a cited artifact.
const METADATA_UNAVAILABLE: ScenarioId = 'evidence-metadata-unavailable'
const LONG_DESCRIPTION_SCENARIO: ScenarioId = 'long-exception-description'
const LONG_PRECINCT_SCENARIO: ScenarioId = 'long-precinct-name'

const scenarios = buildScenarios()
const byId = new Map<string, TimelineScenario>(scenarios.map(scenario => [scenario.id, scenario]))

function scenarioOf(id: ScenarioId): TimelineScenario {
  const scenario = byId.get(id)
  if (!scenario) throw new Error(`scenario ${id} is missing`)
  return scenario
}

function renderScenario(scenario: TimelineScenario) {
  return render(
    <TripTimeline
      trip={scenario.trip}
      precincts={scenario.precincts}
      artifactsById={artifactsByIdOf(scenario)}
      artifactLoading={false}
      artifactError={null}
      onRetryArtifacts={vi.fn()}
      onChanged={vi.fn()}
      lastUpdated={null}
      onJump={vi.fn()}
    />,
  )
}

function phaseGroups(phaseName: string): HTMLElement[] {
  return screen.getAllByRole('group', { name: new RegExp(`^${phaseName} phase`) })
}

/** Opens a collapsed card; a card that is already open (no toggle) is returned as is. */
function openCard(group: HTMLElement, phaseName: string): HTMLElement {
  const toggle = within(group).queryByRole('button', { name: new RegExp(`^${phaseName}`) })
  if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
  return group
}

function openAll(): void {
  for (const group of screen.getAllByRole('group')) {
    const label = group.getAttribute('aria-label') ?? ''
    const name = label.replace(/ phase( and exceptions)?$/, '')
    const toggle = within(group).queryByRole('button', { name: new RegExp(`^${name}`) })
    if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
  }
}

beforeEach(() => {
  forensic.canViewForensics = true
  forensic.forensicOn = false
})

afterEach(cleanup)

describe('timeline scenario fixtures: the set', () => {
  it('builds exactly the listed scenarios, once each and in the listed order', () => {
    expect(scenarios.map(scenario => scenario.id)).toEqual([...SCENARIO_IDS])
    expect(new Set(SCENARIO_IDS).size).toBe(SCENARIO_IDS.length)
  })

  it('gives every scenario a heading and a statement of what it demonstrates', () => {
    for (const scenario of scenarios) {
      expect(scenario.title.length, scenario.id).toBeGreaterThan(0)
      expect(scenario.demonstrates.length, scenario.id).toBeGreaterThan(0)
    }
  })

  it('never reuses a phase, exception, artifact or stop id across scenarios (they share one page)', () => {
    const ids = scenarios.flatMap(scenario => [
      ...scenario.trip.phases.map(phase => phase.phase_event_id as string),
      ...scenario.trip.exceptions.map(exception => exception.id as string),
      ...scenario.artifacts.map(artifact => artifact.id as string),
      ...scenario.trip.stops.map(stop => stop.id),
    ])

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points every image at a file that exists under public/dev-fixtures', () => {
    const urls = scenarios.flatMap(scenario => scenario.artifacts.map(artifact => artifact.signed_url))
      .filter((url): url is string => url !== null)

    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith(PUBLIC_IMAGE_PREFIX), url).toBe(true)
      expect(existsSync(resolve(PUBLIC_DIR, url.slice(1))), url).toBe(true)
    }
    for (const url of Object.values(FIXTURE_IMAGES)) expect(existsSync(resolve(PUBLIC_DIR, url.slice(1))), url).toBe(true)
  })
})

describe.each(SCENARIO_IDS)('timeline scenario fixtures: %s', id => {
  const scenario = scenarioOf(id)
  const { trip } = scenario

  it('has a valid phase plan: contiguous sequence, one trip_creation first, every stop real', () => {
    const phases = [...trip.phases].sort((a, b) => a.sequence_number - b.sequence_number)

    expect(phases.map(phase => phase.sequence_number)).toEqual(phases.map((_, index) => index))
    expect(phases[0]?.phase_type).toBe('trip_creation')
    expect(phases.filter(phase => phase.phase_type === 'trip_creation')).toHaveLength(1)
    expect(new Set(phases.map(phase => phase.phase_event_id)).size).toBe(phases.length)
    for (const phase of phases) {
      expect(phase.trip_id).toBe(trip.id)
      if (phase.phase_type !== 'trip_creation') expect(trip.stops.some(stop => stop.id === phase.trip_stop_id), phase.phase_event_id).toBe(true)
    }
    for (const stop of trip.stops) expect(scenario.precincts.some(precinct => precinct.id === stop.precinct_id), stop.id).toBe(true)
  })

  it('attributes every artifact to a phase of this trip, and every exception to a phase or the trip', () => {
    const phaseIds = new Set(trip.phases.map(phase => phase.phase_event_id as string))
    const artifactIds = new Set(scenario.artifacts.map(artifact => artifact.id as string))

    for (const artifact of scenario.artifacts) {
      expect(artifact.trip_id).toBe(trip.id)
      // Attribution is a pair: a role without a phase (or the reverse) is rejected by the server.
      expect(artifact.phase_event_id === null, artifact.id).toBe(artifact.evidence_role === null)
      if (artifact.phase_event_id !== null) expect(phaseIds.has(artifact.phase_event_id), artifact.id).toBe(true)
    }
    for (const exception of trip.exceptions) {
      expect(exception.trip_id).toBe(trip.id)
      if (exception.phase_event_id !== null) expect(phaseIds.has(exception.phase_event_id), exception.id).toBe(true)
      if (exception.supporting_artifact_id !== null) expect(artifactIds.has(exception.supporting_artifact_id), exception.id).toBe(true)
    }
  })

  it('cites only artifacts that exist, except where the scenario is about a cited artifact that cannot be read', () => {
    const artifactIds = new Set(scenario.artifacts.map(artifact => artifact.id as string))
    const cited = trip.phases.flatMap(phase => [
      phase.seal_photo_artifact_id, phase.waybill_photo_artifact_id, phase.gate_photo_artifact_id, phase.pod_photo_artifact_id,
      phase.pod_signature_artifact_id, phase.linehaul_photo_artifact_id ?? null,
    ]).filter((citedId): citedId is string => citedId !== null)
    const unresolved = cited.filter(citedId => !artifactIds.has(citedId))

    if (id === METADATA_UNAVAILABLE) expect(unresolved.length).toBeGreaterThan(0)
    else expect(unresolved).toEqual([])
  })

  it.each([false, true])('renders the real TripTimeline without throwing (forensic %s)', forensicOn => {
    forensic.forensicOn = forensicOn

    renderScenario(scenario)

    expect(screen.getByRole('region', { name: 'Trip timeline' })).toBeInTheDocument()
    const groups = screen.getAllByRole('group').filter(group => /phase( and exceptions)?$/.test(group.getAttribute('aria-label') ?? ''))
    expect(groups).toHaveLength(trip.phases.length)
  })
})

describe('timeline scenario fixtures: each scenario shows what it claims', () => {
  it('normal-single-leg: a finished trip with four photographed phases, a receiver confirmation and a trip-level note', () => {
    renderScenario(scenarioOf('normal-single-leg'))

    expect(phaseGroups('Departure')).toHaveLength(1)
    expect(within(phaseGroups('Departure')[0]!).getByText('Checks passed')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Trip-level events' })).toBeInTheDocument()
    openAll()
    expect(screen.getByText(/Receiver confirmed delivery/)).toBeInTheDocument()
  })

  it('cross-dock-13-phase: thirteen phases, the second leg live, both legs open', () => {
    const scenario = scenarioOf('cross-dock-13-phase')
    renderScenario(scenario)

    expect(scenario.trip.phases).toHaveLength(13)
    const legs = phaseGroups('In Transit')
    expect(legs).toHaveLength(2)
    for (const leg of legs) expect(within(leg).queryByRole('button', { name: /^In Transit/ })).toBeNull()
  })

  it('four-stop-three-legs: three in_transit legs, none behind a toggle', () => {
    renderScenario(scenarioOf('four-stop-three-legs'))

    const legs = phaseGroups('In Transit')
    expect(legs).toHaveLength(3)
    for (const leg of legs) expect(within(leg).queryByRole('button', { name: /^In Transit/ })).toBeNull()
  })

  it('transit-active-critical: a live leg that needs attention because of an unreviewed critical exception', () => {
    const scenario = scenarioOf('transit-active-critical')
    renderScenario(scenario)

    const leg = phaseGroups('In Transit')[0]!
    expect(within(leg).getByText('Needs attention')).toBeInTheDocument()
    expect(scenario.trip.exceptions.some(e => e.severity === 'critical' && e.review_status === 'needs_review')).toBe(true)
  })

  it('transit-resolved-none: a finished leg with nothing recorded says so, and never "Checks passed"', () => {
    renderScenario(scenarioOf('transit-resolved-none'))

    const leg = phaseGroups('In Transit')[0]!
    expect(within(leg).getByText('No exceptions recorded')).toBeInTheDocument()
    expect(within(leg).queryByText('Checks passed')).toBeNull()
  })

  it('transit-resolved-reviewed: a finished leg with a reviewed deviation', () => {
    renderScenario(scenarioOf('transit-resolved-reviewed'))

    expect(within(phaseGroups('In Transit')[0]!).getByText('Exception reviewed')).toBeInTheDocument()
  })

  it('offline-arrival: the arrival names both the phone clock and the server clock', () => {
    renderScenario(scenarioOf('offline-arrival'))
    openAll()

    expect(screen.getAllByText(/\(device clock\)/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Received .*\(server clock\)/).length).toBeGreaterThan(0)
  })

  it('three-seal-uploads: three uploads on the live phase read as one group of three', () => {
    renderScenario(scenarioOf('three-seal-uploads'))
    openAll()

    expect(screen.getByText(line(/^3 photos uploaded$/))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument()
  })

  it('tracker-dark: no precinct verdict was recorded, so the phase is "Not fully verified"', () => {
    renderScenario(scenarioOf('tracker-dark'))

    expect(within(phaseGroups('Departure')[0]!).getByText('Not fully verified')).toBeInTheDocument()
    openAll()
    expect(screen.getAllByText('Truck precinct check unavailable').length).toBeGreaterThan(0)
  })

  it('parcel-count-failed: an amber node and a named shortfall on a phase that raised no exception', () => {
    const scenario = scenarioOf('parcel-count-failed')
    renderScenario(scenario)

    const confirmation = phaseGroups('Confirmation')[0]!
    expect(within(confirmation).getByText('Needs attention')).toBeInTheDocument()
    expect(confirmation.querySelector('[data-node-type]')).toHaveAttribute('data-node-type', 'warn')
    expect(scenario.trip.exceptions).toHaveLength(0)
  })

  it('cancelled-mid-phase: uploads on an unfinished phase are kept, labelled as not submitted, one received after cancellation', () => {
    renderScenario(scenarioOf('cancelled-mid-phase'))
    openAll()

    expect(screen.getAllByText('Not submitted — trip cancelled').length).toBeGreaterThan(0)
    expect(screen.getByText('Received after the trip was cancelled')).toBeInTheDocument()
  })

  it('cancelled-en-route: a cancelled leg keeps its exception rows', () => {
    const scenario = scenarioOf('cancelled-en-route')
    renderScenario(scenario)

    const leg = phaseGroups('In Transit')[0]!
    expect(scenario.trip.status).toBe('cancelled')
    expect(within(leg).getAllByRole('button', { name: /exception/i }).length).toBeGreaterThanOrEqual(scenario.trip.exceptions.length)
  })

  it('evidence-metadata-unavailable: a cited photo that cannot be read keeps its row, with no invented time', () => {
    renderScenario(scenarioOf('evidence-metadata-unavailable'))
    openAll()

    expect(screen.getAllByText('Time unavailable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Recorded artifact unavailable').length).toBeGreaterThan(0)
  })

  it('photo-absent: a resolved phase states that no seal photo was submitted', () => {
    renderScenario(scenarioOf('photo-absent'))
    openAll()

    expect(screen.getByText('No seal photo submitted at completion')).toBeInTheDocument()
  })

  it('phase-overridden: the override, its note and the fact that checks did not run', () => {
    renderScenario(scenarioOf('phase-overridden'))

    const departure = phaseGroups('Departure')[0]!
    expect(within(departure).getByText('Closed by dispatcher override')).toBeInTheDocument()
    expect(within(departure).getByText(/Checks did not run/)).toBeInTheDocument()
  })

  it('anchor-pending: "Anchoring pending" appears with forensic mode on, and nowhere with it off', () => {
    renderScenario(scenarioOf('anchor-pending'))
    openAll()
    expect(screen.queryByText('Anchoring pending')).toBeNull()
    cleanup()

    forensic.forensicOn = true
    renderScenario(scenarioOf('anchor-pending'))
    openAll()
    expect(screen.getAllByText('Anchoring pending').length).toBeGreaterThan(0)
  })

  it('anchor-failed: the card warns whatever the mode, and forensic mode adds the row', () => {
    renderScenario(scenarioOf('anchor-failed'))
    openAll()
    expect(screen.getByText('Anchor failed — receipt still owed')).toBeInTheDocument()
    expect(screen.queryByText('Anchoring failed')).toBeNull()
    cleanup()

    forensic.forensicOn = true
    renderScenario(scenarioOf('anchor-failed'))
    openAll()
    expect(screen.getByText('Anchoring failed')).toBeInTheDocument()
  })

  it('signature-unattributed: an unattributed signature is "submitted as", never "Receiver confirmed"', () => {
    renderScenario(scenarioOf('signature-unattributed'))
    openAll()

    expect(screen.getByText('Submitted as receiver confirmation')).toBeInTheDocument()
    expect(screen.queryByText(/Receiver confirmed delivery/)).toBeNull()
  })

  it('fifteen-exceptions: the leg shows the cap and says how many more there are', () => {
    const scenario = scenarioOf('fifteen-exceptions')
    renderScenario(scenario)

    const total = scenario.trip.exceptions.length
    const leg = phaseGroups('In Transit')[0]!
    expect(total).toBe(15)
    const rows = within(leg).getAllByRole('button', { name: /Open in exceptions panel/ }).filter(row => !/^\+\d+ more/.test(row.getAttribute('aria-label') ?? ''))
    expect(rows).toHaveLength(EXCEPTION_ROW_CAP)
    expect(within(leg).getByRole('button', { name: `+${total - EXCEPTION_ROW_CAP} more · Open in exceptions panel` })).toBeInTheDocument()
  })

  it('long-exception-description: the record carries exactly the stated number of characters, and the row renders', () => {
    const scenario = scenarioOf(LONG_DESCRIPTION_SCENARIO)
    const long = scenario.trip.exceptions.find(exception => exception.description.length === FIXTURE_LONG_DESCRIPTION_LENGTH)

    renderScenario(scenario)

    expect(long).toBeDefined()
    expect(FIXTURE_LONG_DESCRIPTION_LENGTH).toBe(400)
    expect(screen.getByText(long!.description.slice(0, 40), { exact: false })).toBeInTheDocument()
  })

  it('long-precinct-name: the full precinct label reaches the phase header', () => {
    const scenario = scenarioOf(LONG_PRECINCT_SCENARIO)
    const longPrecinct = scenario.precincts.find(precinct => scenario.trip.stops.some(stop => stop.precinct_id === precinct.id && precinct.name.length > 60))
    const label = longPrecinct?.name.split('—')[0]?.trim() ?? ''

    renderScenario(scenario)

    expect(label.length).toBeGreaterThan(60)
    expect(screen.getAllByText(new RegExp(label.replace(/[()]/g, '\\$&'))).length).toBeGreaterThan(0)
  })
})
