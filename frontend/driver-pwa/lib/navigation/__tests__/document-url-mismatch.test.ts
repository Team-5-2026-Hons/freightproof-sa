import { describe, expect, it } from 'vitest'
import { HOME_PATH, isStrandedHomeDocument } from '../document-url-mismatch'

describe('isStrandedHomeDocument', () => {
  it('test_home_itself_is_never_stranded', () => {
    for (const pathname of [HOME_PATH, '', '/index.html', '//']) {
      expect(isStrandedHomeDocument(pathname)).toBe(false)
    }
  })

  it('test_the_linehaul_step_url_is_the_case_this_exists_for', () => {
    expect(isStrandedHomeDocument('/trip/phase/loading/step/1-linehaul')).toBe(true)
  })

  it('test_every_other_screen_url_is_stranded_too', () => {
    for (const pathname of ['/trips', '/profile', '/trip/in-transit', '/trips/active', '/evidence']) {
      expect(isStrandedHomeDocument(pathname)).toBe(true)
    }
  })

  it('test_a_trailing_slash_does_not_turn_a_screen_into_home', () => {
    expect(isStrandedHomeDocument('/trips/')).toBe(true)
  })
})
