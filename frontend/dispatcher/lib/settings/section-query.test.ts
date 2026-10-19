import { describe, expect, it } from 'vitest'
import { resolveSection, SETTINGS_SECTION_IDS } from './section-query'

const VISIBLE = [{ id: 'account' }, { id: 'display' }]

describe('resolveSection', () => {
  it('opens the section the URL names', () => {
    expect(resolveSection('display', VISIBLE)).toBe(VISIBLE[1])
  })

  it.each([null, '', 'nonsense'])('falls back to the first section for %j', (raw) => {
    expect(resolveSection(raw, VISIBLE)).toBe(VISIBLE[0])
  })

  it('does not open a section the dispatcher cannot see', () => {
    // A regular dispatcher following an admin's link to the forensic section.
    expect(resolveSection(SETTINGS_SECTION_IDS.forensic, VISIBLE)).toBe(VISIBLE[0])
  })

  it('matches ids exactly, not by case or prefix', () => {
    expect(resolveSection('Display', VISIBLE)).toBe(VISIBLE[0])
    expect(resolveSection('disp', VISIBLE)).toBe(VISIBLE[0])
  })
})
