'use client'

import { api } from '@/lib/api/client'
import type { PPCapabilities } from '@shared/lib/types/pp'
import { useAsyncData } from './useAsyncData'

const DEFAULT_CAPS: PPCapabilities = { manifest_lookup: false }

export function usePpCapabilities(): PPCapabilities {
  const { data } = useAsyncData<PPCapabilities>(
    () => api.get<PPCapabilities>('/api/v1/pp/capabilities'),
    DEFAULT_CAPS,
  )
  return data
}
