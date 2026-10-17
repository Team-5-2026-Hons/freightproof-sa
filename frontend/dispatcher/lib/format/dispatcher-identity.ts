import type { DispatcherUser } from '@/lib/types/user'

// Shown when there is no name to take initials from (session still loading).
const FALLBACK_INITIALS = 'D'

/** Humanises the DispatcherUser role for display; the base "Dispatcher" label covers the
 *  non-admin role and an unknown user. */
export function roleLabel(role: DispatcherUser['role'] | undefined): string {
  return role === 'admin_dispatcher' ? 'Admin Dispatcher' : 'Dispatcher'
}

/** First letter of the first and last name; a single-word name yields one letter. */
export function initialsOf(fullName: string | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return FALLBACK_INITIALS
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}
