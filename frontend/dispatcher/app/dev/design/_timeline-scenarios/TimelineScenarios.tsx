'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { buildScenarios, type TimelineScenario } from '@/components/domain/__fixtures__/phase-acts'
import { Button } from '@/components/ui/Button'
import { useDocked } from '@/components/ui/DetailPanel'
import { AuthContext } from '@/lib/context/AuthContext'
import { ForensicModeProvider, useForensicMode } from '@/lib/context/ForensicModeContext'
import type { AuthState, DispatcherUser, UserId } from '@/lib/types/user'
import { Z } from '@shared/lib/z-index'
import { VIEWPORT_PRESETS, presetDocksPanel, type ViewportPreset } from './frame'
import { ScenarioView } from './ScenarioView'

// A preview identity for this subtree only. ForensicOnly is gated on an admin role, and this page
// is outside the signed-in app shell, so without it forensic mode could never be turned on. The
// fixtures are synthetic and nothing here can authorise a request: the API client reads the real
// Supabase session, not this context.
const PREVIEW_USER: DispatcherUser = {
  id: 'preview-admin' as UserId,
  organization_id: 'preview-organisation',
  organization_name: 'Preview Operator',
  email: 'preview@example.test',
  full_name: 'Preview Admin',
  is_active: true,
  role: 'admin_dispatcher',
}
const PREVIEW_AUTH: AuthState = {
  user: PREVIEW_USER,
  isLoading: false,
  signIn: async () => undefined,
  signOut: async () => undefined,
}

const DEFAULT_PRESET: ViewportPreset = VIEWPORT_PRESETS[0] as ViewportPreset
const subscribeNever = (): (() => void) => () => undefined

/** True once the page has hydrated. The scenarios are built against "now" (so a live leg's time
 *  on the road is believable), which differs between the server and the browser: rendering them
 *  only on the client keeps the two from disagreeing. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
}

/**
 * "Trip timeline scenarios": the hard cases of the live evidence rail, each rendered by the real
 * TripTimeline and the real exceptions panel from fixture trips. Width is a frame around the
 * timeline; forensic mode is the real context; the panel docks or overlays by the real window
 * width, which this page cannot fake, so the page says which it is and the window is resized
 * to change it.
 */
export function TimelineScenarios() {
  const hydrated = useHydrated()
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id)
  const preset = VIEWPORT_PRESETS.find(candidate => candidate.id === presetId) ?? DEFAULT_PRESET
  // Read once, so a re-render never shifts every fixture's clock under the reader.
  const [anchorMs] = useState(() => Date.now())
  const scenarios = useMemo<TimelineScenario[]>(() => (hydrated ? buildScenarios(anchorMs) : []), [hydrated, anchorMs])

  return (
    <section className="mb-12" aria-label="Trip timeline scenarios">
      <h2 className="mb-2 text-title text-on-surf">Trip timeline scenarios</h2>
      <p className="mb-4 max-w-3xl text-body text-on-surf-v">
        The real timeline and the real exceptions panel, fed by fixture trips for the hard cases. Everything is synthetic, including the
        photographs, which are generated drawings. Click an exception row to open it in the panel, and use &quot;Show in timeline&quot; to come back to the row.
      </p>
      {hydrated ? (
        <AuthContext.Provider value={PREVIEW_AUTH}>
          <ForensicModeProvider>
            <Controls presetId={presetId} onPreset={setPresetId} preset={preset} />
            <nav aria-label="Scenarios" className="mb-8">
              <ol className="columns-1 gap-8 text-body md:columns-2">
                {scenarios.map(scenario => (
                  <li key={scenario.id}><a className="text-sec underline underline-offset-4" href={`#scenario-${scenario.id}`}>{scenario.title}</a></li>
                ))}
              </ol>
            </nav>
            {scenarios.map((scenario, index) => <ScenarioView key={scenario.id} scenario={scenario} position={index + 1} preset={preset} />)}
          </ForensicModeProvider>
        </AuthContext.Provider>
      ) : null}
    </section>
  )
}

interface ControlsProps {
  presetId: string
  preset: ViewportPreset
  onPreset: (id: string) => void
}

function Controls({ presetId, preset, onPreset }: ControlsProps) {
  const { forensicOn, toggle } = useForensicMode()
  const docked = useDocked()
  const wantsDock = presetDocksPanel(preset)
  return (
    <div className="mb-6 bg-surface py-3" style={{ position: 'sticky', top: 0, zIndex: Z.sticky }}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preview controls">
        {VIEWPORT_PRESETS.map(candidate => (
          <Button key={candidate.id} variant={candidate.id === presetId ? 'primary' : 'secondary'} size="sm" aria-pressed={candidate.id === presetId} onClick={() => onPreset(candidate.id)}>
            {candidate.label} · {presetDocksPanel(candidate) ? 'panel docked' : 'panel overlay'}
          </Button>
        ))}
        <Button variant={forensicOn ? 'primary' : 'secondary'} size="sm" aria-pressed={forensicOn} onClick={toggle}>
          Forensic mode: {forensicOn ? 'on (anchor rows, audit trail)' : 'off'}
        </Button>
      </div>
      {/* The width control only sizes the frame. DetailPanel decides docked or overlay from the real
          window (a 1280 px media query), so a mismatch is stated rather than faked. */}
      <p role="status" className="mt-2 max-w-3xl text-meta text-on-surf-v">
        Exceptions panel in this window: {docked ? 'docked (window is 1280 px or wider)' : 'overlay (window is narrower than 1280 px)'}.
        {docked !== wantsDock && ` The ${preset.label} preset expects it ${wantsDock ? 'docked' : 'an overlay'}: resize the browser window to ${wantsDock ? '1280 px or wider' : 'under 1280 px'} to match.`}
        {' '}The forensic switch is the app&apos;s own and is remembered between visits.
      </p>
    </div>
  )
}
