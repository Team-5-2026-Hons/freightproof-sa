import { describe, it, expect, beforeEach } from 'vitest'
import { backTarget, recordScreen, resetBackStack } from '@/lib/navigation/back-stack'

const FALLBACK = '/fallback'

function visit(pathname: string, direction: 'forward' | 'back' | 'none' = 'forward', url = pathname) {
  recordScreen(pathname, url, direction)
}

describe('back stack', () => {
  beforeEach(() => {
    resetBackStack()
  })

  it('test_in_transit_opened_from_home_goes_back_home', () => {
    visit('/', 'none')
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe('/')
  })

  it('test_trip_detail_opened_from_trips_goes_back_to_trips', () => {
    visit('/trips', 'none')
    visit('/trips/active')

    expect(backTarget(FALLBACK)).toBe('/trips')
  })

  it('test_cold_start_uses_the_fallback', () => {
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe(FALLBACK)
  })

  it('test_a_tab_switch_starts_a_fresh_stack', () => {
    visit('/', 'none')
    visit('/trip/in-transit')
    visit('/settings', 'none')

    expect(backTarget(FALLBACK)).toBe(FALLBACK)
  })

  it('test_returning_to_a_screen_cuts_the_stack_back_to_it', () => {
    // Home → In Transit → Log Exception → (submit pushes) In Transit
    visit('/', 'none')
    visit('/trip/in-transit')
    visit('/trip/in-transit/exception')
    visit('/trip/in-transit')

    // Back from In Transit is Home, not the submitted form.
    expect(backTarget(FALLBACK)).toBe('/')
  })

  it('test_back_skips_finished_phase_steps_and_panic', () => {
    // Home → Start Departure → steps → departure pushes In Transit
    visit('/', 'none')
    visit('/trip/phase/departure/step/2-capture-seal')
    visit('/trip/phase/departure/step/4-departure')
    visit('/trip/panic')
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe('/')
  })

  it('test_backing_out_of_a_cold_start_never_loops', () => {
    // Relaunch onto In Transit → back (fallback Trip) → back (fallback Trips).
    visit('/trip/in-transit')
    visit('/trips/active', 'back')

    // Trip was reached by going back, so nothing known sits behind it: its own fallback,
    // not the In Transit screen the driver just left.
    expect(backTarget('/trips')).toBe('/trips')
  })

  it('test_back_returns_the_full_url_with_its_query', () => {
    visit('/trips', 'none')
    visit('/trips/detail', 'forward', '/trips/detail?id=abc')
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe('/trips/detail?id=abc')
  })
})
