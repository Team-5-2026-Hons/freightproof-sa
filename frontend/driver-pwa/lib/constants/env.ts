// true/unset = demo mode, skips real Supabase auth and drives login/OTP from
// AuthContext's mock flow instead. Flip NEXT_PUBLIC_DEMO_MODE to 'false' once
// the real Supabase-session -> AuthContext hydration lands.
export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'
