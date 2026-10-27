import { describe, it, expect } from 'vitest'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { stepTitle } from '../step-titles'

describe('stepTitle', () => {
  it('test_every_step_in_every_recipe_has_a_driver_facing_title', () => {
    for (const slugs of Object.values(STEP_SLUGS)) {
      for (const slug of slugs) expect(stepTitle(slug), slug).not.toBeNull()
    }
  })

  it('test_titles_say_what_to_do_not_the_system_name', () => {
    expect(stepTitle('2-verification')).toBe('Start your trip')
    expect(stepTitle('1-linehaul')).toBe('Check the linehaul sheet')
  })

  it('test_unknown_slug_is_null', () => {
    expect(stepTitle('9-nope')).toBeNull()
  })
})
