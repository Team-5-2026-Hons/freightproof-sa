import type { OtpAuthPort } from '@shared/lib/auth/port'
import { getSupabase } from '@/lib/supabase'
import { IS_DEMO_MODE } from '@/lib/constants/env'

import { ApiDriverProfileSource } from './ApiDriverProfileSource'
import { DemoDriverProfileSource } from './DemoDriverProfileSource'
import { DemoOtpAuth } from './DemoOtpAuth'
import type { DriverProfileSource } from './DriverProfileSource'
import { SupabaseOtpAuth } from './SupabaseOtpAuth'

let otpAuth: OtpAuthPort | undefined
let profileSource: DriverProfileSource | undefined

/** The auth backend the app uses unless a provider is handed another one. */
export function defaultOtpAuth(): OtpAuthPort {
  otpAuth ??= IS_DEMO_MODE ? new DemoOtpAuth() : new SupabaseOtpAuth(getSupabase())
  return otpAuth
}

/** The profile source the app uses unless a provider is handed another one. */
export function defaultProfileSource(): DriverProfileSource {
  profileSource ??= IS_DEMO_MODE ? new DemoDriverProfileSource() : new ApiDriverProfileSource()
  return profileSource
}
