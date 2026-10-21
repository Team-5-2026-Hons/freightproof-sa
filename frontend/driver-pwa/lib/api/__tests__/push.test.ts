// frontend/driver-pwa/lib/api/__tests__/push.test.ts
import { describe, it, expect, vi } from 'vitest'

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }))

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
}))

import { registerPushToken } from '../push'

describe('registerPushToken', () => {
  it('posts the token and platform to the driver\'s own push-token route', async () => {
    mockPost.mockResolvedValueOnce(undefined)

    await registerPushToken('fcm-token-1', 'android')

    expect(mockPost).toHaveBeenCalledWith('/api/v1/drivers/me/push-tokens', { token: 'fcm-token-1', platform: 'android' })
  })
})
