// true/unset = demo mode: skips real Supabase auth, drives login/OTP from AuthContext's mock flow.
export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'

// Google Maps JS API key (components/map/DriverMap.tsx). Absent is a supported state —
// the APK must build without one — so DriverMap degrades to a coordinates card instead
// of throwing. Normalised to '' so callers test one falsy shape instead of two.
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
