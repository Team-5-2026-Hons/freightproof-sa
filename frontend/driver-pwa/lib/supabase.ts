import { createClient } from '@supabase/supabase-js'

// Fallback placeholders so this module loads during static export (output: 'export')
// even when Supabase env vars are unset — IS_DEMO_MODE gates the real auth path,
// so these values are only ever exercised once Supabase is actually configured.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
