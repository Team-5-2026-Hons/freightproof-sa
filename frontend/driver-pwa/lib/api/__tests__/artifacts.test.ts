// frontend/driver-pwa/lib/api/__tests__/artifacts.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadArtifact, MAX_ARTIFACT_UPLOAD_BYTES } from '../artifacts'
import { ApiError } from '../client'

// Keep the real ApiError class (uploadArtifact throws it and instanceof must hold)
// while stubbing out the network layer.
const mockPostForm = vi.fn()
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>()
  return {
    ...actual,
    api: { ...actual.api, postForm: (...args: unknown[]) => mockPostForm(...args) },
  }
})

const PARAMS = {
  tripId: 'trip-1',
  artifactType: 'photo' as const,
  dataUrl: 'data:image/jpeg;base64,AAAA',
  capturedAt: '2026-07-17T10:00:00Z',
}

// uploadArtifact converts the data URL to a Blob via fetch(dataUrl) — stub fetch so
// each test controls the resulting blob's size without building a real 10 MB data URL.
function stubFetchedBlobOfSize(size: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob([new ArrayBuffer(size)])),
    }),
  )
}

describe('uploadArtifact pre-upload size check (audit fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws a terminal 413 ApiError before any network call when the photo exceeds the cap', async () => {
    stubFetchedBlobOfSize(MAX_ARTIFACT_UPLOAD_BYTES + 1)

    const err: unknown = await uploadArtifact(PARAMS).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    // 413 matters: isQueueableFailure retries only status 0 / >=500, so this must be
    // terminal — an oversized photo can never succeed on retry.
    expect((err as ApiError).status).toBe(413)
    expect((err as ApiError).message).toMatch(/too large/i)
    expect(mockPostForm).not.toHaveBeenCalled()
  })

  it('uploads a photo at or under the cap normally', async () => {
    stubFetchedBlobOfSize(1024)
    mockPostForm.mockResolvedValue({ id: 'artifact-1', file_hash: 'f'.repeat(64) })

    const result = await uploadArtifact(PARAMS)

    expect(mockPostForm).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ id: 'artifact-1', file_hash: 'f'.repeat(64) })
  })
})

describe('uploadArtifact attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubFetchedBlobOfSize(1024)
    mockPostForm.mockResolvedValue({ id: 'artifact-1', file_hash: 'f'.repeat(64) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function sentForm(): FormData {
    return mockPostForm.mock.calls[0][1] as FormData
  }

  it('sends both attribution fields or neither', async () => {
    await uploadArtifact({
      ...PARAMS,
      attribution: { phaseEventId: 'phase-1', role: 'seal_photo' },
    })
    const attributed = sentForm()

    mockPostForm.mockClear()
    await uploadArtifact(PARAMS)
    const unattributed = sentForm()

    expect(attributed.get('phase_event_id')).toBe('phase-1')
    expect(attributed.get('evidence_role')).toBe('seal_photo')
    // An older-style call must stay byte-compatible with what the backend already accepts:
    // a lone field would 422, so the unattributed form carries neither.
    expect(unattributed.has('phase_event_id')).toBe(false)
    expect(unattributed.has('evidence_role')).toBe(false)
  })
})

describe('uploadArtifact filename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostForm.mockResolvedValue({ id: 'artifact-1', file_hash: 'f'.repeat(64) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubBlob(type: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob([new ArrayBuffer(16)], { type })),
    }))
  }

  it('names a PDF .pdf', async () => {
    stubBlob('application/pdf')

    await uploadArtifact({ ...PARAMS, artifactType: 'document' })

    const file = (mockPostForm.mock.calls[0][1] as FormData).get('file') as File
    expect(file.name).toBe('document.pdf')
  })

  it('keeps .jpg for photos', async () => {
    stubBlob('image/jpeg')

    await uploadArtifact(PARAMS)

    const file = (mockPostForm.mock.calls[0][1] as FormData).get('file') as File
    expect(file.name).toBe(`${PARAMS.artifactType}.jpg`)
  })
})
