import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { TYPE_ROLES } from '@/lib/constants/type-scale'

describe('cn with the iOS type roles', () => {
  it('keeps the text colour when a type role is merged with it', () => {
    // Arrange
    const classes = ['text-primary-on', 'text-body']

    // Act
    const merged = cn(...classes)

    // Assert — the regression: an unregistered `text-body` was read as a colour and
    // deleted text-primary-on, leaving the primary button's label black on black.
    expect(merged).toBe('text-primary-on text-body')
  })

  it.each(TYPE_ROLES)('treats text-%s as a font size, not a colour', (role) => {
    // Arrange
    const classes = ['text-sm', `text-${role}`, 'text-error']

    // Act
    const merged = cn(...classes)

    // Assert — the later size wins over text-sm, and the colour survives.
    expect(merged).toBe(`text-${role} text-error`)
  })
})
