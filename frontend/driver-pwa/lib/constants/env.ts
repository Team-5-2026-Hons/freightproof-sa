// true/unset = demo mode: the DemoOtpAuth and DemoDriverProfileSource adapters stand in for Supabase auth and the profile API.
export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'

export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
