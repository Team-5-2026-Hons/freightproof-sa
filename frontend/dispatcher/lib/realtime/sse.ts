// Pure SSE helpers, kept free of React/supabase imports so they can be unit-tested
// (and reasoned about) in isolation from the RealtimeProvider that uses them.

import type { RealtimeEvent } from './types'

export const STREAM_PATH = '/api/v1/stream'

// SSE frames are separated by a blank line.
export const FRAME_SEPARATOR = '\n\n'

// Reconnect backoff: exponential from 1s, capped at 15s, then halved-plus-jitter so a
// fleet of dispatchers doesn't reconnect in lockstep after a backend blip.
export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_MAX_MS = 15_000

export function backoffMs(attempt: number, rng: () => number = Math.random): number {
  const capped = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS)
  return capped / 2 + rng() * (capped / 2)
}

// Parse one raw SSE frame into an event, or null for comment/heartbeat/empty frames
// (`: connected`, `: heartbeat`) and anything unparseable.
export function parseFrame(frame: string): RealtimeEvent | null {
  const dataLines = frame.split('\n').filter(line => line.startsWith('data:'))
  if (dataLines.length === 0) return null
  const payload = dataLines.map(line => line.replace(/^data:\s?/, '')).join('\n')
  try {
    return JSON.parse(payload) as RealtimeEvent
  } catch {
    return null
  }
}
