import { beforeEach, expect, it, vi } from 'vitest'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import { uploadLateEvidenceArtifact, uploadSubstitutionArtifact } from '../driver-substitutions'

const { postForm, formData } = vi.hoisted(() => ({ postForm: vi.fn(), formData: vi.fn() }))
vi.mock('../client', () => ({ api: { postForm }, ApiError: class extends Error {} }))
vi.mock('../artifacts', () => ({ artifactFormData: formData, ARTIFACT_UPLOAD_TIMEOUT_MS: 30_000 }))

beforeEach(() => {
  vi.clearAllMocks()
  bindActorLease('driver-a', invalidateActorLease())
  postForm.mockResolvedValue({ id: 'artifact' })
})

it.each(['handover', 'late'] as const)('the_%s_wrapper_keeps_its_actor_across_multipart_preparation', async kind => {
  let prepared!: (form: FormData) => void
  formData.mockImplementationOnce(() => new Promise<FormData>(resolve => { prepared = resolve }))
  const upload = { artifactType: 'photo' as const, dataUrl: 'original bytes', capturedAt: new Date().toISOString(), clientRequestId: crypto.randomUUID() }
  const pending = kind === 'handover'
    ? uploadSubstitutionArtifact('trip', 'request', 'incoming', upload)
    : uploadLateEvidenceArtifact('trip', 0, upload)
  prepared(new FormData())
  bindActorLease('driver-b', invalidateActorLease())
  bindActorLease('driver-a', invalidateActorLease())

  await expect(pending).rejects.toThrow('Account changed')
  expect(postForm).not.toHaveBeenCalled()
})
