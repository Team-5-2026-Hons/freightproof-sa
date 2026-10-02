import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  previewPPManifest: vi.fn(),
}))

import { ApiError, previewPPManifest } from '@/lib/api/client'
import { makePreview } from '@/lib/trips/__fixtures__/preview'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'
import { useManifestPreview } from './useManifestPreview'

const mockedPreview = vi.mocked(previewPPManifest)
const PREVIEW_82 = makePreview({
  pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 82, display: 'The Courier Guy · CPT 82' },
})

beforeEach(() => {
  mockedPreview.mockReset()
})

describe('useManifestPreview', () => {
  it('loads the preview for a number', async () => {
    const preview = makePreview()
    mockedPreview.mockResolvedValue(preview)
    const { result } = renderHook(() => useManifestPreview())

    await act(async () => { await result.current.lookUp(81) })

    expect(mockedPreview).toHaveBeenCalledWith(81)
    expect(result.current.state).toEqual({ status: 'loaded', manifestNumber: 81, preview })
  })

  it('classifies a failed lookup', async () => {
    mockedPreview.mockRejectedValue(new ApiError(404, 'PP manifest 999 not found'))
    const { result } = renderHook(() => useManifestPreview())

    await act(async () => { await result.current.lookUp(999) })

    expect(result.current.state).toMatchObject({ status: 'failed', manifestNumber: 999, failure: { kind: 'not_found' } })
  })

  it('ignores an answer that arrives after a newer lookup', async () => {
    let answerSlow: (preview: PPManifestPreview) => void = () => {}
    mockedPreview
      .mockImplementationOnce(() => new Promise<PPManifestPreview>(resolve => { answerSlow = resolve }))
      .mockResolvedValueOnce(PREVIEW_82)
    const { result } = renderHook(() => useManifestPreview())

    let slow: Promise<void> = Promise.resolve()
    act(() => { slow = result.current.lookUp(81) })
    await act(async () => { await result.current.lookUp(82) })
    await act(async () => { answerSlow(makePreview()); await slow })

    expect(result.current.state).toEqual({ status: 'loaded', manifestNumber: 82, preview: PREVIEW_82 })
  })

  it('replace shows a fresh preview and outranks a lookup still in flight', async () => {
    let answerSlow: (preview: PPManifestPreview) => void = () => {}
    mockedPreview.mockImplementationOnce(() => new Promise<PPManifestPreview>(resolve => { answerSlow = resolve }))
    const fresh = makePreview({ snapshot_sha256: 'b'.repeat(64) })
    const { result } = renderHook(() => useManifestPreview())

    let slow: Promise<void> = Promise.resolve()
    act(() => { slow = result.current.lookUp(81) })
    act(() => { result.current.replace(fresh) })
    await act(async () => { answerSlow(makePreview()); await slow })

    expect(result.current.state).toEqual({ status: 'loaded', manifestNumber: 81, preview: fresh })
  })

  it('reset returns to idle', async () => {
    mockedPreview.mockResolvedValue(makePreview())
    const { result } = renderHook(() => useManifestPreview())
    await act(async () => { await result.current.lookUp(81) })

    act(() => { result.current.reset() })

    expect(result.current.state).toEqual({ status: 'idle' })
  })
})
