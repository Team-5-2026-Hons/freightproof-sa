import { expect, test, vi } from 'vitest'
import { issueHandoverToken } from '../handover'
const post = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/client', () => ({ api: { post } }))

test.each([false, true])('qr_sequence_is_sent_in_query (force=%s)', async (force) => {
  post.mockClear()
  await issueHandoverToken('trip', 'phase', force, 1)
  const [path, body] = post.mock.calls[0]
  const url = new URL(path as string, 'https://test.invalid')
  expect(url.searchParams.get('custody_sequence')).toBe('1')
  expect(url.searchParams.get('force')).toBe(force ? 'true' : null)
  expect(body).toBeUndefined()
})
