'use client'

import { api } from '@/lib/api/client'
import type { PPCapabilities } from '@shared/lib/types/pp'
import { useAsyncData } from './useAsyncData'

// Manifest lookup only exists on the mock PP client today (PP v28 has no such
// endpoint) — the wizard renders the manifest field only when the backend says so.
const DEFAULT_CAPS: PPCapabilities = { manifest_lookup: false }

export function usePpCapabilities(): PPCapabilities {
  // useAsyncData leaves `data` at its last good value (the initial default here)
  // when the fetch fails, which is exactly the degraded behaviour we want:
  // hide the manifest field rather than surface an error banner.
  const { data } = useAsyncData<PPCapabilities>(
    () => api.get<PPCapabilities>('/api/v1/pp/capabilities'),
    DEFAULT_CAPS,
  )
  return data
}
