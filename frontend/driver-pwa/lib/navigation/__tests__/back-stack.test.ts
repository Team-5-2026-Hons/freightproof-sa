import { describe, it, expect, beforeEach } from 'vitest'
import { backTarget, previousScreen, recordScreen, resetBackStack } from '@/lib/navigation/back-stack'

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
    visit('/', 'none')
    visit('/trip/in-transit')
    visit('/trip/in-transit/exception')
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe('/')
  })

  it('test_back_skips_finished_phase_steps_and_panic', () => {
    visit('/', 'none')
    visit('/trip/phase/departure/step/2-capture-seal')
    visit('/trip/phase/departure/step/4-departure')
    visit('/trip/panic')
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe('/')
  })

  it('test_backing_out_of_a_cold_start_never_loops', () => {
    visit('/trip/in-transit')
    visit('/trips/active', 'back')

    expect(backTarget('/trips')).toBe('/trips')
  })

  it('test_back_returns_the_full_url_with_its_query', () => {
    visit('/trips', 'none')
    visit('/trips/detail', 'forward', '/trips/detail?id=abc')
    visit('/trip/in-transit')

    expect(backTarget(FALLBACK)).toBe('/trips/detail?id=abc')
  })

  it('test_previous_screen_is_null_on_a_root_and_the_earlier_screen_otherwise', () => {
    visit('/', 'none')
    expect(previousScreen()).toBeNull()

    visit('/trips/active')

    expect(previousScreen()).toBe('/')
  })
})
