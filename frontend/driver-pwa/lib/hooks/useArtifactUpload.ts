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

export interface ArtifactUploadState {
  /**
   * Upload a captured data URL now. Resolves the artifact id, or null if the upload
   * didn't land — callers store the id when they get one and otherwise keep the data
   * URL they already hold.
   */
  uploadNow: (dataUrl: string, artifactType: ArtifactType, capturedAt: string) => Promise<string | null>
}

export function useArtifactUpload(tripId: string): ArtifactUploadState {
  // Guards a resolved upload from writing into an unmounted step's draft: the driver can
  // photograph and immediately navigate back, and a late setState on a dead component is
  // a React warning at best and a write into the wrong phase's draft at worst.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const uploadNow = useCallback(
    async (dataUrl: string, artifactType: ArtifactType, capturedAt: string): Promise<string | null> => {
      // Demo mode has no backend to upload to; the submit path short-circuits there too.
      if (IS_DEMO_MODE) return null
      try {
        const artifact = await uploadArtifact({ tripId, artifactType, dataUrl, capturedAt })
        return mounted.current ? artifact.id : null
      } catch (err: unknown) {
        // Logged, never surfaced: the driver captured their photo successfully, and the
        // submit path will re-upload it. Telling them an upload failed would be asking
        // them to act on something that is already handled.
        console.warn('Early artifact upload failed — will upload at submit instead', err)
        return null
      }
    },
    [tripId],
  )

  return { uploadNow }
}
