'use client'

import { useCallback, useRef, useState } from 'react'
import { previewPPManifest } from '@/lib/api/client'
import { classifyLookupError, type LookupFailure } from '@/lib/trips/trip-api-errors'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'

export type ManifestPreviewState =
  | { status: 'idle' }
  | { status: 'loading'; manifestNumber: number }
  | { status: 'loaded'; manifestNumber: number; preview: PPManifestPreview }
  | { status: 'failed'; manifestNumber: number; failure: LookupFailure }

export interface UseManifestPreviewResult {
  state: ManifestPreviewState
  lookUp: (manifestNumber: number) => Promise<void>
  /** Show a preview the server returned elsewhere (a 409 MANIFEST_CHANGED body). */
  replace: (preview: PPManifestPreview) => void
  reset: () => void
}

/** The manifest lookup on the create-trip screen (spec §10.1). Read-only. */
export function useManifestPreview(): UseManifestPreviewResult {
  const [state, setState] = useState<ManifestPreviewState>({ status: 'idle' })
  // Each change takes a ticket, and only the newest may write. A slow answer for 81 must
  // not replace the summary for 82 that the dispatcher asked for after it.
  const ticket = useRef(0)

  const lookUp = useCallback(async (manifestNumber: number): Promise<void> => {
    const mine = ++ticket.current
    setState({ status: 'loading', manifestNumber })
    try {
      const preview = await previewPPManifest(manifestNumber)
      if (mine === ticket.current) setState({ status: 'loaded', manifestNumber, preview })
    } catch (err) {
      // Classified and shown by ManifestLookup: a failed lookup is a screen state, not an
      // exception to rethrow.
      if (mine === ticket.current) {
        setState({ status: 'failed', manifestNumber, failure: classifyLookupError(err, manifestNumber) })
      }
    }
  }, [])

  const replace = useCallback((preview: PPManifestPreview): void => {
    ticket.current += 1
    setState({ status: 'loaded', manifestNumber: preview.pp_manifest.number, preview })
  }, [])

  const reset = useCallback((): void => {
    ticket.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, lookUp, replace, reset }
}
