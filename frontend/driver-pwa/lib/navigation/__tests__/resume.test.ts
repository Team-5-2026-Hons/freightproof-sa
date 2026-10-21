import { beforeEach, describe, expect, it } from 'vitest'
import {
  RESUME_MAX_AGE_MS, RESUME_SCREEN_KEY, forgetScreen, isResumableRoute, rememberScreen, takeResumeScreen,
} from '../resume'

const NOW = new Date('2026-10-21T08:00:00Z')
const DRIVER = 'driver-a'
const STEP = '/trip/phase/loading/step/1-linehaul'

beforeEach(() => {
  window.localStorage.clear()
})

describe('isResumableRoute', () => {
  it('test_phase_steps_in_transit_and_the_handover_check_are_resumable', () => {
    expect(isResumableRoute(STEP)).toBe(true)
    expect(isResumableRoute('/trip/in-transit')).toBe(true)
    expect(isResumableRoute('/trip/in-transit/checkpoint')).toBe(true)
    expect(isResumableRoute('/trips/substitution')).toBe(true)
  })

  it('test_tab_roots_lists_and_trip_pages_are_not', () => {
    for (const path of ['/', '/trips', '/profile', '/trips/active', '/trips/detail', '/trips/past', '/evidence', '/trip/panic']) {
      expect(isResumableRoute(path)).toBe(false)
    }
  })
})

describe('rememberScreen / takeResumeScreen', () => {
  it('test_a_remembered_step_is_returned_once_to_the_same_driver', () => {
    rememberScreen(STEP, DRIVER, NOW)

    expect(takeResumeScreen(DRIVER, new Date(NOW.getTime() + 60_000))).toBe(STEP)
    // Single use: the next cold start is a plain cold start.
    expect(takeResumeScreen(DRIVER, NOW)).toBeNull()
  })

  it('test_the_query_string_rides_along_for_the_handover_check', () => {
    rememberScreen('/trips/substitution?trip=t1&request=r1', DRIVER, NOW)

    expect(takeResumeScreen(DRIVER, NOW)).toBe('/trips/substitution?trip=t1&request=r1')
  })

  it('test_a_screen_that_is_not_a_workflow_is_never_remembered', () => {
    rememberScreen('/profile', DRIVER, NOW)

    expect(window.localStorage.getItem(RESUME_SCREEN_KEY)).toBeNull()
    expect(takeResumeScreen(DRIVER, NOW)).toBeNull()
  })

  it('test_another_driver_on_the_same_phone_is_not_dropped_into_the_step', () => {
    rememberScreen(STEP, DRIVER, NOW)

    expect(takeResumeScreen('driver-b', NOW)).toBeNull()
    // And the record is consumed, not left for a later sign-in by the original driver.
    expect(takeResumeScreen(DRIVER, NOW)).toBeNull()
  })

  it('test_a_stale_record_is_ignored', () => {
    rememberScreen(STEP, DRIVER, NOW)

    expect(takeResumeScreen(DRIVER, new Date(NOW.getTime() + RESUME_MAX_AGE_MS + 1))).toBeNull()
  })

  it('test_leaving_on_purpose_forgets_the_screen', () => {
    rememberScreen(STEP, DRIVER, NOW)
    forgetScreen()

    expect(takeResumeScreen(DRIVER, NOW)).toBeNull()
  })

  it('test_garbage_in_storage_is_not_a_crash_or_a_redirect', () => {
    window.localStorage.setItem(RESUME_SCREEN_KEY, '{not json')
    expect(takeResumeScreen(DRIVER, NOW)).toBeNull()

    window.localStorage.setItem(RESUME_SCREEN_KEY, JSON.stringify({ url: 'https://evil.example/', actorId: DRIVER, savedAt: NOW.toISOString() }))
    expect(takeResumeScreen(DRIVER, NOW)).toBeNull()
  })
})
