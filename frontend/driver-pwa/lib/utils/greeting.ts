// Home's greeting line: the part of the day, and the driver's first name.

// Local-time boundaries, the conventional split: morning until noon, afternoon until 17:00.
const AFTERNOON_STARTS_HOUR = 12
const EVENING_STARTS_HOUR = 17

export function partOfDayGreeting(now: Date): string {
  const hour = now.getHours()
  if (hour < AFTERNOON_STARTS_HOUR) return 'Good morning'
  if (hour < EVENING_STARTS_HOUR) return 'Good afternoon'
  return 'Good evening'
}

/** "Sipho Dlamini" → "Sipho". Empty or whitespace-only names give null, so no "Good morning, ". */
export function firstName(fullName: string): string | null {
  const first = fullName.trim().split(/\s+/)[0]
  return first ? first : null
}
