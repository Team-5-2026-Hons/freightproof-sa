// One-way move of exception reports queued in localStorage by the previous build into the
// IndexedDB store. A driver can update the app with a report still queued; it must not be
// lost or, worse, re-uploaded as a duplicate photo.
import type { RaiseExceptionBody } from '@/lib/api/exceptions'
import { saveExceptionEnvelope, type ExceptionEnvelope, type ExceptionPhotoRecord } from './exception-store'
import { dataUrlToBlob } from './exception-sync'

export interface LegacyExceptionEntry {
  kind: 'exception'
  id: string
  tripId: string
  body: RaiseExceptionBody
  photoDataUrl?: string
  photoCapturedAt?: string
  enqueuedAt: string
}

const LEGACY_PHOTO_ID_PREFIX = 'legacy-photo:'

export function legacyEntryToEnvelope(entry: LegacyExceptionEntry): ExceptionEnvelope {
  const { supporting_artifact_id: knownId, ...withoutKnownId } = entry.body
  const { supporting_artifact_ids: ignoredIds, ...body } = withoutKnownId
  void ignoredIds
  const uploadedArtifactId = knownId ?? null
  const photos: ExceptionPhotoRecord[] = []
  const photoId = `${LEGACY_PHOTO_ID_PREFIX}${entry.id}`
  if (entry.photoDataUrl) {
    photos.push({
      id: photoId,
      blob: dataUrlToBlob(entry.photoDataUrl),
      capturedAt: entry.photoCapturedAt ?? entry.enqueuedAt,
      uploadedArtifactId,
    })
  } else if (uploadedArtifactId) {
    photos.push({
      id: photoId,
      blob: null,
      capturedAt: entry.photoCapturedAt ?? entry.enqueuedAt,
      uploadedArtifactId,
    })
  }
  return {
    clientReportId: body.client_report_id ?? entry.id,
    tripId: entry.tripId,
    body,
    photos,
    status: 'quarantined',
    attentionReason: null,
    attentionPhotoId: null,
    actorId: null,
    createdAt: entry.enqueuedAt,
    updatedAt: entry.enqueuedAt,
  }
}

export async function migrateLegacyExceptionEntries(io: {
  readLegacy: () => LegacyExceptionEntry[]
  dropLegacy: (ids: string[]) => boolean
}): Promise<{ migrated: number; failed: number }> {
  const groups = new Map<string, LegacyExceptionEntry[]>()
  for (const entry of io.readLegacy()) {
    const key = entry.body.client_report_id ?? entry.id
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }

  let migrated = 0
  let failed = 0
  for (const entries of groups.values()) {
    try {
      const envelopes = entries.map(legacyEntryToEnvelope)
      const photos = new Map<string, ExceptionPhotoRecord>()
      for (const envelope of envelopes) {
        for (const photo of envelope.photos) if (!photos.has(photo.id)) photos.set(photo.id, photo)
      }
      await saveExceptionEnvelope({ ...envelopes[0], photos: [...photos.values()] })
      if (io.dropLegacy(entries.map((e) => e.id)) === false) {
        console.warn('Could not remove migrated legacy exception report from localStorage')
        failed += 1
        continue
      }
      migrated += 1
    } catch (err) {
      console.warn('Could not migrate legacy exception report; leaving it queued', err)
      failed += 1
    }
  }
  return { migrated, failed }
}
