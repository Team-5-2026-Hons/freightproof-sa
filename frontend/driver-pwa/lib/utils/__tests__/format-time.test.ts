import { describe, expect, test } from 'vitest'
import { formatDateTime, formatTime, formatTimeWithSeconds } from '../format-time'

// Output pinned to en-ZA; the formatters are built lazily on first call, so the same
// instant must format identically on the first and every later call.
describe('format-time', () => {
  const instant = new Date(2026, 6, 1, 6, 5, 9) // local time: 06:05:09 on Wed 1 Jul 2026

  test('formatTime renders hours and minutes and is stable across calls', () => {
    const first = formatTime(instant)

    expect(first).toMatch(/06:05/)
    expect(formatTime(instant)).toBe(first)
    expect(formatTime(instant.toISOString())).toBe(first)
  })

  test('formatTimeWithSeconds includes the seconds', () => {
    expect(formatTimeWithSeconds(instant)).toMatch(/06:05:09/)
  })

  test('formatDateTime includes weekday, day, month and time', () => {
    const text = formatDateTime(instant)

    expect(text).toMatch(/Wed/)
    expect(text).toMatch(/1/)
    expect(text).toMatch(/Jul/)
    expect(text).toMatch(/06:05/)
  })
})
