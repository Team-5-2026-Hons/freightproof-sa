'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { parsePrefill, type TripPrefill } from '@/lib/trips/prefill'
import type { CrewValues, RoutePicks, ScheduleOverrides } from '@/lib/trips/manifest-form'

/** Shown at the top of the form while a prefill is in effect. */
export interface PrefillNotice {
  /** Some values in the link weren't recognised and were left blank. */
  leftBlank: boolean
}

interface PrefillTargets {
  driverIds: ReadonlySet<string>
  horseIds: ReadonlySet<string>
  trailerIds: ReadonlySet<string>
  precinctIds: ReadonlySet<string>
  /** The pickers' lists have arrived, so an id can be checked against them. */
  listsLoaded: boolean
  setMode: (mode: 'manifest' | 'empty_leg') => void
  setManifestInput: (value: string) => void
  lookUp: (manifestNumber: number) => Promise<void>
  setCrew: (crew: CrewValues) => void
  setPicks: (picks: RoutePicks) => void
  setOverrides: (overrides: ScheduleOverrides) => void
}

type Stage = 'mode' | 'fields' | 'done'

/** Fill the create-trip form from an assistant link (spec §7.3, D2a), once per link.
 *
 *  The link is read with useSearchParams, never window.location: on a click inside the app, Next.js updates the
 *  address bar only after the new page has rendered, so window.location still held the previous page's address and
 *  the form opened empty (Tom's browser test, 22 Oct, B39). A new link while the form is already open fills it again. Mode and manifest number are set straight away and the manifest is
 *  looked up as if typed; crew, route and times wait for the pickers' lists, and only ids those lists hold are used,
 *  anything else is left blank and the note says so. Fields are set during render (React's pattern for state that
 *  follows something else), guarded by a stage so it happens once and the dispatcher's edits always win. The address
 *  is then tidied back to the plain form, so a refresh never fills it in again. Nothing is created. */
export function useTripPrefill(targets: PrefillTargets): { notice: PrefillNotice | null; dismiss: () => void } {
  const search = useSearchParams().toString()
  const [seenSearch, setSeenSearch] = useState(search)
  const [prefill, setPrefill] = useState<TripPrefill | null>(() => parsePrefill(new URLSearchParams(search)))
  const [stage, setStage] = useState<Stage>(prefill === null ? 'done' : 'mode')
  const [unrecognised, setUnrecognised] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // The link whose manifest was looked up: once per link, even under Strict Mode's double effect.
  const lookedUp = useRef<TripPrefill | null>(null)

  if (search !== seenSearch) {
    setSeenSearch(search)
    // Tidying the address (below) also lands here, with no prefill: keep what was filled in.
    const next = parsePrefill(new URLSearchParams(search))
    if (next !== null) {
      setPrefill(next)
      setStage('mode')
      setUnrecognised(false)
      setDismissed(false)
    }
  }

  if (prefill !== null && stage === 'mode') {
    setStage('fields')
    targets.setMode(prefill.mode)
    if (prefill.manifestNumber !== null) targets.setManifestInput(String(prefill.manifestNumber))
  }
  if (prefill !== null && stage === 'fields' && targets.listsLoaded) {
    setStage('done')
    const known = (id: string | null, ids: ReadonlySet<string>): string => (id !== null && ids.has(id) ? id : '')
    const trailers = prefill.trailerIds.filter((id) => targets.trailerIds.has(id))
    targets.setCrew({
      driverId: known(prefill.driverId, targets.driverIds), horseId: known(prefill.horseId, targets.horseIds), trailerIds: trailers,
    })
    if (prefill.mode === 'empty_leg') {
      targets.setPicks({ originId: known(prefill.originId, targets.precinctIds), destinationId: known(prefill.destinationId, targets.precinctIds) })
    }
    targets.setOverrides({ departure: prefill.departure, arrival: prefill.arrival })
    const ends = prefill.mode === 'empty_leg' ? [prefill.originId, prefill.destinationId] : []
    setUnrecognised(
      (prefill.driverId !== null && !targets.driverIds.has(prefill.driverId))
      || (prefill.horseId !== null && !targets.horseIds.has(prefill.horseId))
      || trailers.length !== prefill.trailerIds.length
      || ends.some((id) => id !== null && !targets.precinctIds.has(id)),
    )
  }

  const { lookUp } = targets
  useEffect(() => {
    if (prefill === null || lookedUp.current === prefill) return
    // Once per link, even under Strict Mode's double effect: the lookup reaches Parcel Perfect's quota.
    lookedUp.current = prefill
    window.history.replaceState(null, '', window.location.pathname)
    if (prefill.manifestNumber !== null) void lookUp(prefill.manifestNumber)
  }, [prefill, lookUp])

  const notice = prefill === null || dismissed ? null : { leftBlank: prefill.dropped.length > 0 || unrecognised }
  return { notice, dismiss: () => setDismissed(true) }
}
