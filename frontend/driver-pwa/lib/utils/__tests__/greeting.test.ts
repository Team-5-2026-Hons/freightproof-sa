import { describe, it, expect } from 'vitest'
import { firstName, partOfDayGreeting } from '@/lib/utils/greeting'

function at(hour: number): Date {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d
}

describe('partOfDayGreeting', () => {
  it('test_before_noon_is_morning', () => {
    expect(partOfDayGreeting(at(6))).toBe('Good morning')
  })

  it('test_noon_starts_the_afternoon', () => {
    expect(partOfDayGreeting(at(12))).toBe('Good afternoon')
  })

  it('test_five_pm_starts_the_evening', () => {
    expect(partOfDayGreeting(at(17))).toBe('Good evening')
  })
})

describe('firstName', () => {
  it('test_takes_the_first_word', () => {
    expect(firstName('Sipho Dlamini')).toBe('Sipho')
  })

  it('test_ignores_surrounding_whitespace', () => {
    expect(firstName('  Thandi   Nkosi ')).toBe('Thandi')
  })

  it('test_blank_name_gives_null', () => {
    expect(firstName('   ')).toBeNull()
  })
})
