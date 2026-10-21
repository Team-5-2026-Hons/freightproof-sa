// frontend/driver-pwa/lib/api/push.ts
//
// Tells the backend which device token reaches this driver, so a GATE_ARRIVAL push has
// somewhere to go. Called on every app launch: the backend upserts on the token, so a
// repeat only refreshes it, and a device that changed hands moves to the new driver.
import { api } from './client'

export type PushPlatform = 'android' | 'ios'

export const registerPushToken = (token: string, platform: PushPlatform): Promise<void> =>
  api.post<void>('/api/v1/drivers/me/push-tokens', { token, platform })
