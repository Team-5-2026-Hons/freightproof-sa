'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { backTarget } from '@/lib/navigation/back-stack'
import { markTransition } from '@/lib/navigation/transition-direction'

/**
 * A back action that returns to the screen the driver came from (lib/navigation/back-stack),
 * or to `fallback` when there is none — a cold start, a deep link, a push notification.
 */
export function useBack(fallback: string): () => void {
  const router = useRouter()
  return useCallback(() => {
    markTransition('back')
    router.push(backTarget(fallback))
  }, [router, fallback])
}
