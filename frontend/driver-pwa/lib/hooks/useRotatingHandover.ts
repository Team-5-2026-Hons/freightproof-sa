// frontend/driver-pwa/lib/hooks/useRotatingHandover.ts
//
// Owns the two clocks the receiver-handover step runs on (FP-237/238): the rotation that
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

// How often the driver's screen asks whether the receiver has confirmed. Fast enough that
// the step advances while the receiver is still handing the phone back; slow enough that a
// ten-minute handover is a couple of hundred requests, not a couple of thousand.
const POLL_INTERVAL_MS = 3_000

// Fallback cadence, used only if a response somehow arrives without one. Matches the
// server default so a missing field degrades to the intended behaviour rather than to a
// tight loop.
const FALLBACK_ROTATION_SECONDS = 20

export interface RotatingHandover {
  /** The URL to encode into the QR. Null before the first token, or once paused. */
  scanUrl: string | null
  /** True once the receiver's browser has the link open — the rotation has stopped. */
  receiverOpened: boolean
  /** Set once the receiver has confirmed — this is what the step writes to the draft. */
  signatureArtifactId: string | null
  confirmedAt: string | null
  /** Non-null when the LAST issue attempt failed. The previous QR stays on screen. */
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

  // Read by both timers to stop all work the moment the handover is done. Refs, not the
  // state above, because the interval callbacks close over their creation-time scope and
  // would otherwise keep firing against a stale `false`.
  const isDoneRef = useRef(false)
  const isPausedRef = useRef(false)
  const rotationSecondsRef = useRef(FALLBACK_ROTATION_SECONDS)

  const issue = useCallback(async (force = false) => {
    if (isDoneRef.current) return
    // Paused means the receiver is holding a live code. Minting another would retire it
    // out from under them mid-handover, which is the exact failure the server-side pause
    // exists to prevent — so the client must not keep asking either.
    if (isPausedRef.current && !force) return

    setIsIssuing(true)
    try {
      const res = await issueHandoverToken(tripId, phaseEventId, force)
      rotationSecondsRef.current = res.rotate_after_seconds > 0
        ? res.rotate_after_seconds
        : FALLBACK_ROTATION_SECONDS
      isPausedRef.current = res.receiver_opened
      setReceiverOpened(res.receiver_opened)
      // Only overwrite the displayed code when the server actually issued one. A paused
      // response carries no URL, and blanking the QR then would take a working code away
      // from a receiver who is mid-scan.
      if (res.scan_url !== null) setScanUrl(res.scan_url)
      setError(null)
    } catch (err) {
      // The previously displayed QR is deliberately LEFT on screen. It is still valid
      // until its own expiry, so blanking it would punish a receiver mid-scan for a
      // refresh that failed afterwards.
      console.warn('[handover] could not issue the next QR:', err)
      setError('Could not refresh the code. Check your signal.')
    } finally {
      setIsIssuing(false)
    }
  }, [tripId, phaseEventId])

  useEffect(() => {
    void issue()
    const timer = setInterval(() => {
      if (isDoneRef.current || isPausedRef.current) return
      void issue()
    }, rotationSecondsRef.current * 1_000)
    return () => clearInterval(timer)
  }, [issue])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (isDoneRef.current) return
      try {
        const res = await fetchHandoverStatus(tripId, phaseEventId)
        if (cancelled) return

        // Mirrored into the ref as well as state: the rotation interval reads the ref,
        // and learning about the open link from the poll is usually faster than waiting
        // for the next issue call to report it.
        if (res.receiver_opened) {
          isPausedRef.current = true
          setReceiverOpened(true)
        }
        if (!res.confirmed) return

        isDoneRef.current = true
        setSignatureArtifactId(res.signature_artifact_id)
        setConfirmedAt(res.confirmed_at)
      } catch (err) {
        // Swallowed to a warning on purpose: a poll is a read that will be retried in
        // three seconds, and surfacing every transient failure would put an error message
        // under a QR code that is working perfectly well.
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
