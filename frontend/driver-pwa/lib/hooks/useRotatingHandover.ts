// Owns the two clocks the receiver-handover step runs on: the rotation that
// replaces the displayed QR, and the poll that watches for the receiver's confirmation
// landing server-side.
//
// They are separate intervals on purpose. The rotation cadence is a security parameter
// the server owns (HANDOVER_ROTATION_SECONDS, echoed on every issue response); the poll
// cadence is a responsiveness choice this app owns. Tying them together would mean either
// polling as slowly as the QR rotates — leaving the driver staring at a screen for twenty
// seconds after the receiver has already finished — or minting tokens as fast as we poll,
// which is the loop HANDOVER_ISSUE's rate budget exists to refuse.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHandoverStatus, issueHandoverToken } from '@/lib/api/handover'
import { captureCustody } from '@/lib/session/custody-context'

const POLL_INTERVAL_MS = 3_000

const FALLBACK_ROTATION_SECONDS = 20

export interface RotatingHandover {
  scanUrl: string | null
  receiverOpened: boolean
  signatureArtifactId: string | null
  confirmedAt: string | null
  error: string | null
  isIssuing: boolean
  /** Retire whatever is outstanding and mint a fresh code. The driver's escape hatch. */
  forceNewCode: () => void
}

export function useRotatingHandover(tripId: string, phaseEventId: string): RotatingHandover {
  const [scanUrl, setScanUrl] = useState<string | null>(null)
  const [receiverOpened, setReceiverOpened] = useState(false)
  const [signatureArtifactId, setSignatureArtifactId] = useState<string | null>(null)
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isIssuing, setIsIssuing] = useState(false)

  const isDoneRef = useRef(false)
  const isPausedRef = useRef(false)
  const rotationSecondsRef = useRef(FALLBACK_ROTATION_SECONDS)

  const issue = useCallback(async (force = false) => {
    if (isDoneRef.current) return
    if (isPausedRef.current && !force) return

    setIsIssuing(true)
    try {
      const res = await issueHandoverToken(tripId, phaseEventId, force, captureCustody(tripId).custodySequence)
      rotationSecondsRef.current = res.rotate_after_seconds > 0
        ? res.rotate_after_seconds
        : FALLBACK_ROTATION_SECONDS
      isPausedRef.current = res.receiver_opened
      setReceiverOpened(res.receiver_opened)
      if (res.scan_url !== null) setScanUrl(res.scan_url)
      setError(null)
    } catch (err) {
      console.warn('[handover] could not issue the next QR:', err)
      setError('Could not refresh the code. Check your signal.')
    } finally {
      setIsIssuing(false)
    }
  }, [tripId, phaseEventId])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      await issue()
      if (cancelled || isDoneRef.current) return
      timer = setTimeout(() => void tick(), rotationSecondsRef.current * 1_000)
    }

    void tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [issue])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (isDoneRef.current) return
      try {
        const res = await fetchHandoverStatus(tripId, phaseEventId)
        if (cancelled) return

        if (res.receiver_opened) {
          isPausedRef.current = true
          setReceiverOpened(true)
        }
        if (!res.confirmed) return

        isDoneRef.current = true
        setSignatureArtifactId(res.signature_artifact_id)
        setConfirmedAt(res.confirmed_at)
      } catch (err) {
        console.warn('[handover] status poll failed:', err)
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [tripId, phaseEventId])

  const forceNewCode = useCallback(() => {
    isPausedRef.current = false
    setReceiverOpened(false)
    void issue(true)
  }, [issue])

  return {
    scanUrl, receiverOpened, signatureArtifactId, confirmedAt, error, isIssuing, forceNewCode,
  }
}
