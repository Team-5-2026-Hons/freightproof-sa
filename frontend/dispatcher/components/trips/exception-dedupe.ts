import type { TripException } from '@shared/lib/types/exception'

/**
 * Polling can briefly merge the same server record twice. Keep the first occurrence
 * so every dispatcher exception surface reports the same record and count.
 */
export function uniqueExceptionsById(exceptions: readonly TripException[]): TripException[] {
  const seen = new Set<string>()
  return exceptions.filter(exception => {
    if (seen.has(exception.id)) return false
    seen.add(exception.id)
    return true
  })
}
