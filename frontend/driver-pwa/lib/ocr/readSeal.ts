// Reads the seal number off the seal photo with the phone's own text recognition (ML Kit
// on Android, Apple Vision on iOS). On-device: the photo is not sent anywhere for this,
// it works without signal, and it costs nothing per photo. The browser PWA has no
// equivalent, so it reports 'unavailable' and the driver types the number as before.
import { Capacitor } from '@capacitor/core'
import { Ocr } from '@capacitor-community/image-to-text'
import { parseSealCandidates } from './parseSeal'

export type SealReading =
  | { kind: 'found'; value: string }
  | { kind: 'none' }
  | { kind: 'unavailable' }

export const SEAL_OCR_TIMEOUT_MS = 4000

const DATA_URL_PREFIX = /^data:[^,]*,/

const TIMED_OUT = Symbol('timed out')

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err: unknown) => { clearTimeout(timer); reject(err) },
    )
  })
}

export function canReadSeals(): boolean {
  return Capacitor.isNativePlatform()
}

export async function readSealFromPhoto(dataUrl: string): Promise<SealReading> {
  if (!canReadSeals()) return { kind: 'unavailable' }
  try {
    const result = await withTimeout(
      Ocr.detectText({ base64: dataUrl.replace(DATA_URL_PREFIX, '') }),
      SEAL_OCR_TIMEOUT_MS,
    )
    if (result === TIMED_OUT) return { kind: 'unavailable' }
    const candidates = parseSealCandidates(result.textDetections.map((d) => d.text).join('\n'))
    const [only] = candidates
    return candidates.length === 1 && only !== undefined ? { kind: 'found', value: only } : { kind: 'none' }
  } catch (err: unknown) {
    console.warn('Seal OCR failed — the driver types the number instead', err)
    return { kind: 'unavailable' }
  }
}
