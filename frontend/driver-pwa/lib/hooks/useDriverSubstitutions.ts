"use client"

import { useContext } from 'react'
import {
  DriverSubstitutionContext,
  type DriverSubstitutionState,
} from '@/lib/context/DriverSubstitutionContext'

const NO_PROVIDER: DriverSubstitutionState = {
  pending: [],
  notices: [],
  isLoading: false,
  loadError: null,
  lastRefreshedAt: null,
  refresh: () => Promise.resolve(),
  markNoticeRead: () => Promise.resolve(),
}

/**
 * The driver's substitution arrangements and notices. Unlike useTrip this does not throw
 * outside its provider: Home and Trips are rendered in many existing test harnesses without
 * it, and "no handovers" is the true answer for every one of them. The (app) layout always
 * mounts the provider, so real screens never see this fallback.
 */
export function useDriverSubstitutions(): DriverSubstitutionState {
  return useContext(DriverSubstitutionContext) ?? NO_PROVIDER
}
