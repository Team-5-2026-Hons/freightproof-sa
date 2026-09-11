'use client'

import { useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

const RECEIPT_LOOKUP_PATH = '/api/v1/blockchain/receipts/lookup'

export type BlockchainReceiptLookupType = 'data_hash' | 'hedera_tx_id'

export interface BlockchainReceiptLookupCriteria {
  type: BlockchainReceiptLookupType
  identifier: string
  subjectId?: string
}

export interface BlockchainReceiptLookupState {
  results: BlockchainReceipt[]
  loading: boolean
  error: string | null
  searched: boolean
  clear: () => void
  lookup: (criteria: BlockchainReceiptLookupCriteria) => Promise<void>
}

export function useBlockchainReceiptLookup(): BlockchainReceiptLookupState {
  const [results, setResults] = useState<BlockchainReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const latestRequestId = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  function clear(): void {
    // Incrementing also prevents an already-running request from republishing stale state.
    latestRequestId.current += 1
    setResults([])
    setLoading(false)
    setError(null)
    setSearched(false)
  }

  async function lookup(criteria: BlockchainReceiptLookupCriteria): Promise<void> {
    // The API client cannot cancel an individual GET, so only the latest submitted
    // request may publish state when concurrent lookups settle out of order.
    const requestId = ++latestRequestId.current
    const params = new URLSearchParams()
    params.set(criteria.type, criteria.identifier.trim())

    const subjectId = criteria.subjectId?.trim()
    if (subjectId) params.set('subject_id', subjectId)

    setLoading(true)
    setError(null)
    setSearched(true)
    setResults([])

    try {
      const nextResults = await api.get<BlockchainReceipt[]>(
        `${RECEIPT_LOOKUP_PATH}?${params.toString()}`,
      )
      if (!mountedRef.current || requestId !== latestRequestId.current) return
      setResults(nextResults)
    } catch (lookupError: unknown) {
      if (!mountedRef.current || requestId !== latestRequestId.current) return
      console.error('Blockchain receipt lookup failed', lookupError)
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : 'Unable to look up blockchain receipts.',
      )
    } finally {
      if (mountedRef.current && requestId === latestRequestId.current) {
        setLoading(false)
      }
    }
  }

  return { results, loading, error, searched, clear, lookup }
}
