'use client'

import { api } from '@/lib/api/client'
import type { BlockchainReceipt, SubjectType } from '@shared/lib/types/blockchain'
import { useAsyncData } from './useAsyncData'

export function useBlockchainReceipts(
  subjectType: SubjectType,
  subjectId: string | null,
) {
  return useAsyncData<BlockchainReceipt[]>(
    async () => {
      if (!subjectId) return []
      return api.get<BlockchainReceipt[]>(
        `/api/v1/blockchain/receipts?subject_type=${subjectType}&subject_id=${subjectId}`,
      )
    },
    [],
  )
}
