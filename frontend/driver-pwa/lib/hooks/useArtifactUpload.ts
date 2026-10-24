'use client'

// Upload a captured photo the moment it is taken, instead of at submit time.
//
// The driver photographs the seal, walks to the cab, then swipes to confirm — that gap
// used to be dead time, with every photo in the phase uploading only once they swiped,
// on whatever signal they had at that moment. Starting at capture spends the walk
// usefully and leaves the submit sending artifact ids.
//
// Deliberately fire-and-forget: an upload that fails here changes nothing the driver can
// see or act on, because the data URL stays in the draft and lib/api/phases.ts uploads
// it at submit exactly as it always did. This is an optimisation with a fallback, never
// a new way for evidence to go missing.

import { useCallback, useRef, useEffect } from 'react'
import { uploadArtifact, type ArtifactType } from '@/lib/api/artifacts'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { captureCustody } from '@/lib/session/custody-context'
import type { EvidenceRole } from '@shared/lib/types/evidence'

export interface ArtifactUploadState {
  /**
   * Upload a captured data URL now. Resolves the artifact id, or null if the upload
   * didn't land — callers store the id when they get one and otherwise keep the data
   * URL they already hold. Also null when a newer upload for the same role has started,
   * so a slow first upload can never overwrite the retake.
   */
  uploadNow: (
    dataUrl: string,
    artifactType: ArtifactType,
    capturedAt: string,
    role: EvidenceRole,
  ) => Promise<string | null>
}

export function useArtifactUpload(tripId: string, phaseEventId: string): ArtifactUploadState {
  // Guards a resolved upload from writing into an unmounted step's draft: the driver can
  // photograph and immediately navigate back, and a late setState on a dead component is
  // a React warning at best and a write into the wrong phase's draft at worst.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Counts uploads started per role. Requests resolve in whatever order the network
  // delivers them, so a retake's upload can land before the first photo's; a request is
  // only honoured while its number is still the latest for its role. Per role, not
  // global, because a step may capture two different slots independently.
  const latestRequest = useRef<Partial<Record<EvidenceRole, number>>>({})

  const uploadNow = useCallback(
    async (
      dataUrl: string,
      artifactType: ArtifactType,
      capturedAt: string,
      role: EvidenceRole,
    ): Promise<string | null> => {
      // Demo mode has no backend to upload to; the submit path short-circuits there too.
      if (IS_DEMO_MODE) return null
      const requestNumber = (latestRequest.current[role] ?? 0) + 1
      latestRequest.current[role] = requestNumber
      try {
        const artifact = await uploadArtifact({
          tripId, artifactType, dataUrl, capturedAt, attribution: { phaseEventId, role },
          // Upload starts at capture, so this is the capture's own custody period.
          custodySequence: captureCustody(tripId).custodySequence,
        })
        const isSuperseded = latestRequest.current[role] !== requestNumber
        return mounted.current && !isSuperseded ? artifact.id : null
      } catch (err: unknown) {
        // Logged, never surfaced: the driver captured their photo successfully, and the
        // submit path will re-upload it. Telling them an upload failed would be asking
        // them to act on something that is already handled.
        console.warn('Early artifact upload failed — will upload at submit instead', err)
        return null
      }
    },
    [tripId, phaseEventId],
  )

  return { uploadNow }
}
