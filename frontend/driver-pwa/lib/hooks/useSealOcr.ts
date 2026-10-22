'use client'

// Runs seal OCR for a step and says whether the answer still matters when it arrives.
// A retake starts a new read, and reads resolve in whatever order the phone finishes
// them, so only the latest read for this step may touch the draft. Same per-request
// counter idea as useArtifactUpload.

import { useCallback, useEffect, useRef, useState } from 'react'
import { canReadSeals, readSealFromPhoto } from '@/lib/ocr/readSeal'

export type SealOcrResult = { stale: true } | { stale: false; value: string | null }

export interface SealOcrState {
  reading: boolean
  readSeal: (dataUrl: string) => Promise<SealOcrResult>
}

export function useSealOcr(): SealOcrState {
  const [reading, setReading] = useState(false)
  const latestRequest = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const readSeal = useCallback(async (dataUrl: string): Promise<SealOcrResult> => {
    latestRequest.current += 1
    const request = latestRequest.current
    const isCurrent = () => mounted.current && request === latestRequest.current
    // The browser can never read a seal: answering at once keeps "Reading the seal…" from
    // flashing (and being announced) for a read that was never going to happen. Counted as
    // a request all the same, so an older native read still in flight goes stale.
    if (!canReadSeals()) return { stale: false, value: null }
    setReading(true)
    let value: string | null = null
    try {
      const answer = await readSealFromPhoto(dataUrl)
      value = answer.kind === 'found' ? answer.value : null
    } catch (err: unknown) {
      // readSealFromPhoto already turns plugin failures into 'unavailable'; this is the
      // backstop so an unexpected throw can never leave the screen stuck on "Reading".
      console.warn('Seal OCR read failed — the driver types the number instead', err)
    } finally {
      // Only the latest read owns the flag: a stale one finishing must not clear it while
      // the newer read is still running.
      if (isCurrent()) setReading(false)
    }
    return isCurrent() ? { stale: false, value } : { stale: true }
  }, [])

  return { reading, readSeal }
}
