import { describe, expect, it } from 'vitest'
import { initialsOf, roleLabel } from './dispatcher-identity'

describe('initialsOf', () => {
  it.each([
    ['Jane Dispatcher', 'JD'],
    ['Jane Marie Dispatcher', 'JD'],
    ['jane dispatcher', 'JD'],
    ['Jane', 'J'],
    ['  Jane   Dispatcher  ', 'JD'],
  ])('turns %j into %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected)
  })

  it.each([undefined, '', '   '])('falls back for %j', (name) => {
    expect(initialsOf(name)).toBe('D')
  })
})

describe('roleLabel', () => {
  it('spells out the admin role', () => {
    expect(roleLabel('admin_dispatcher')).toBe('Admin Dispatcher')
  })

  it.each(['dispatcher', undefined] as const)('uses the base label for %s', (role) => {
    expect(roleLabel(role)).toBe('Dispatcher')
  })
})
