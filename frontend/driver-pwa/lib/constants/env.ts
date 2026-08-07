// true/unset = demo mode, skips real Supabase auth and drives login/OTP from
// AuthContext's mock flow instead. Flip NEXT_PUBLIC_DEMO_MODE to 'false' once
// the real Supabase-session -> AuthContext hydration lands.
export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'

// Google Maps JS API key for the in-transit driving map (components/map/DriverMap.tsx).
//
// ABSENT IS A SUPPORTED STATE, not an error. `output: 'export'` bakes NEXT_PUBLIC_* into
// the bundle at build time, and the APK has to build and run on a machine that has never
// been given a key — so nothing here may throw or warn on an empty value. DriverMap reads
// this and degrades to a coordinates card rather than mounting a map it cannot tile.
// Normalised to '' (not undefined) so callers test one falsy shape instead of two.
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
