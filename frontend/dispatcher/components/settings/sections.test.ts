import { describe, expect, it, vi } from 'vitest'
import { SETTINGS_SECTIONS, visibleSections } from './sections'
import { SETTINGS_SECTION_IDS } from '@/lib/settings/section-query'

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }))

describe('SETTINGS_SECTIONS', () => {
  it('gives every section a unique id, a label and a description', () => {
    const ids = SETTINGS_SECTIONS.map(section => section.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const section of SETTINGS_SECTIONS) {
      expect(section.label.trim()).not.toBe('')
      expect(section.description.trim()).not.toBe('')
    }
  })

  it('registers every id the rest of the app links to', () => {
    const registered = SETTINGS_SECTIONS.map(section => section.id).sort()

    expect(registered).toEqual(Object.values(SETTINGS_SECTION_IDS).sort())
  })

  it('keeps Account first, since it is the fallback for any bad ?section=', () => {
    expect(SETTINGS_SECTIONS[0].id).toBe(SETTINGS_SECTION_IDS.account)
    expect(SETTINGS_SECTIONS[0].adminOnly).toBeFalsy()
  })
})

describe('visibleSections', () => {
  it('hides admin-only sections from a regular dispatcher', () => {
    expect(visibleSections('dispatcher').map(section => section.id))
      .toEqual([SETTINGS_SECTION_IDS.account, SETTINGS_SECTION_IDS.display])
  })

  it('shows every section to an admin dispatcher', () => {
    expect(visibleSections('admin_dispatcher')).toHaveLength(SETTINGS_SECTIONS.length)
  })

  it('treats an unknown user as a regular dispatcher', () => {
    expect(visibleSections(undefined).some(section => section.adminOnly)).toBe(false)
  })
})
