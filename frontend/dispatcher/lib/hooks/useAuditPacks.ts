'use client'

import { useCallback } from 'react'
import { listAuditPacks } from '@/lib/api/auditPacks'
import type { AuditPack } from '@/lib/types/auditPack'
import { useAsyncData, type AsyncState } from './useAsyncData'

export function useAuditPacks(tripId: string): AsyncState<AuditPack[]> {
  const fetchPacks = useCallback(() => listAuditPacks(tripId), [tripId])
  return useAsyncData<AuditPack[]>(fetchPacks, [])
}
