'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'

export function usePrecincts(): Precinct[] {
  const [precincts, setPrecincts] = useState<Precinct[]>([])

  useEffect(() => {
    api.get<Precinct[]>('/api/v1/precincts')
      .then(setPrecincts)
      .catch(console.error)
  }, [])

  return precincts
}
