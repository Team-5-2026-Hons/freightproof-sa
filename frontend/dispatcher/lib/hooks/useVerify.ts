'use client'

import { useCallback, useState } from 'react'
import { api } from '@/lib/api/client'
import type { SubjectType, VerifyResult } from '@shared/lib/types/blockchain'

export function useVerify() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)

  const verify = useCallback(async (subjectType: SubjectType, subjectId: string) => {
    setLoading(true)
    setResult(null)
    try {
      const r = await api.post<VerifyResult>('/api/v1/blockchain/verify', {
        subject_type: subjectType,
        subject_id: subjectId,
      })
      setResult(r)
      return r
    } finally {
      setLoading(false)
    }
  }, [])

  return { verify, loading, result }
}
