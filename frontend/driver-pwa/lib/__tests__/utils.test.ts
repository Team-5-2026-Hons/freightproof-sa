import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { TYPE_ROLES } from '@/lib/constants/type-scale'

describe('cn with the iOS type roles', () => {
  it('keeps the text colour when a type role is merged with it', () => {
    const classes = ['text-primary-on', 'text-body']

    const merged = cn(...classes)

    expect(merged).toBe('text-primary-on text-body')
  })

  it.each(TYPE_ROLES)('treats text-%s as a font size, not a colour', (role) => {
    const classes = ['text-sm', `text-${role}`, 'text-error']

    const merged = cn(...classes)

    expect(merged).toBe(`text-${role} text-error`)
  })
})
