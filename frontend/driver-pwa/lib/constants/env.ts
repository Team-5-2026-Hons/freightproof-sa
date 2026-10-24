// true/unset = demo mode: the DemoOtpAuth and DemoDriverProfileSource adapters stand in for Supabase auth and the profile API.
export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'

// Google Maps JS API key (components/map/DriverMap.tsx). Absent is a supported state —
// the APK must build without one — so DriverMap degrades to a coordinates card instead
// of throwing. Normalised to '' so callers test one falsy shape instead of two.
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
