import type { DriverUser } from '@/lib/types/user'

/**
 * Returned instead of a profile when the backend never answered, so a driver sees "can't
 * reach FreightProof" rather than being bounced to /login as though they were signed out.
 *
 * Why this distinction is load-bearing: AuthContext reads a null profile as "no session",
 * and the guarded layout redirects on that. A dead API URL, a stalled socket or a 502
 * therefore used to be indistinguishable from a signed-out driver — the failure that cost
 * an evening of debugging on 21 Oct 2026, because the screen said "log in" while the real
 * fault was a stale LAN IP baked into the build.
 */
export interface ProfileUnreachable {
  unreachable: true
}

export type ProfileLoad = DriverUser | ProfileUnreachable | null

/** Narrows a loadProfile() result to the no-answer case. */
export function isProfileUnreachable(result: ProfileLoad): result is ProfileUnreachable {
  return result !== null && 'unreachable' in result && result.unreachable
}

export interface DriverProfileSource {
  /**
   * The signed-in driver's own profile; null when the backend answered but there is no
   * profile to load (not provisioned, wrong role, no session), or ProfileUnreachable
   * when it did not answer at all. The union is deliberately wide rather than a tagged
   * result so an implementation that only ever resolves a driver still satisfies it.
   */
  loadProfile(): Promise<ProfileLoad>
}
