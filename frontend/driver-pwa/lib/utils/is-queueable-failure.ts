// Whether a phase-submission failure is plausibly transient — worth queuing for retry.
// A local validation error or a terminal 4xx can never succeed by simply retrying;
// queuing those would give a misleading "stored on this device" receipt for invalid evidence.
import { ApiError } from '@/lib/api/client'

export function isQueueableFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status >= 500
  return err instanceof TypeError
}
