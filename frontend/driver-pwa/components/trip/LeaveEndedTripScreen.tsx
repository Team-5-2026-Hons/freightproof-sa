'use client'

// A trip screen with no trip behind it is a dead end: when dispatch cancels the trip (or
// stops it from an incident) TripContext drops it, and In Transit, a phase step or the
// active-trip page fell back to a bare "Trip not found." with no way off it. Worse, In
// Transit is a resumable route (lib/navigation/resume.ts), so a cold start replayed the
// dead screen and re-remembered it — killing the app did not get the driver out.
//
// Mounted once in the app layout rather than in each page, so every trip-bound screen
// gets the same exit. Home is where the driver lands: it carries the "Dispatch has ended
// this trip" banner, which deliberately never says why (after a hijacking this phone may
// not be in the driver's hands).

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'
import { PHASE_STEP_PREFIX } from '@/lib/phase/routes'
import { forgetScreen } from '@/lib/navigation/resume'
import { markTransition } from '@/lib/navigation/transition-direction'
import { useOptionalTrip } from '@/lib/hooks/useOptionalTrip'
import { usePhaseSubmissions } from '@/lib/submission/phase-submitter'

// Screens that only make sense while this driver holds a working trip. Panic is left out on
// purpose: its confirmation must never be pulled from under a driver mid-alert, and its own
// "back" leads to In Transit, which this then catches.
const TRIP_BOUND_PREFIXES = [PHASE_STEP_PREFIX, ROUTES.inTransit, ROUTES.activeTripDetail] as const

export function isTripBoundRoute(pathname: string): boolean {
  return TRIP_BOUND_PREFIXES.some(prefix =>
    pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
}

export function LeaveEndedTripScreen(): null {
  const router = useRouter()
  const pathname = usePathname()
  const tripCtx = useOptionalTrip()
  const { inFlight } = usePhaseSubmissions()
  // A submission still running means the trip may only be momentarily absent: the final
  // hand-off closes the trip and routes Home itself, and the step screen keeps its own last
  // copy of the plan for that window (PhaseStepPageClient's lastTripRef).
  const stranded = tripCtx !== null && !tripCtx.isLoading && tripCtx.trip === null
    && inFlight.length === 0 && isTripBoundRoute(pathname)

  useEffect(() => {
    if (!stranded) return
    forgetScreen()
    markTransition('none')
    router.replace(ROUTES.home)
  }, [stranded, router])

  return null
}
