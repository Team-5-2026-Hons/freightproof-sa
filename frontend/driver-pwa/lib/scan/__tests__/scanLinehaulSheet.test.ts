// frontend/driver-pwa/lib/scan/__tests__/scanLinehaulSheet.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockScan, mockCompress } = vi.hoisted(() => ({ mockScan: vi.fn(), mockCompress: vi.fn() }))
vi.mock('@capgo/capacitor-document-scanner', () => ({
  DocumentScanner: { scanDocument: (...a: unknown[]) => mockScan(...a) },
  ResponseType: { Base64: 'base64' },
  ScanDocumentResponseStatus: { Success: 'success', Cancel: 'cancel' },
}))
vi.mock('@/lib/utils/image', () => ({
  fileToCompressedJpegDataUrl: (...a: unknown[]) => mockCompress(...a),
}))

import { scanLinehaulSheet } from '../scanLinehaulSheet'
import { EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT, EVIDENCE_PHOTO_MAX_EDGE_PX } from '@/lib/constants/evidence-photo'

describe('scanLinehaulSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob([new ArrayBuffer(8)], { type: 'image/jpeg' })),
    }))
    mockCompress.mockResolvedValue('data:image/jpeg;base64,SMALL')
  })

  it('scans one page without ML clean-up (letUserAdjustCrop false = base mode)', async () => {
    mockScan.mockResolvedValue({ status: 'success', scannedImages: ['BIGBASE64'] })

    await scanLinehaulSheet()

    expect(mockScan).toHaveBeenCalledWith({
      maxNumDocuments: 1,
      responseType: 'base64',
      letUserAdjustCrop: false,
      croppedImageQuality: EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
    })
  })

  it('returns the scan downscaled to the evidence-photo cap', async () => {
    mockScan.mockResolvedValue({ status: 'success', scannedImages: ['BIGBASE64'] })

    expect(await scanLinehaulSheet()).toBe('data:image/jpeg;base64,SMALL')
    expect(mockCompress).toHaveBeenCalledWith(expect.any(File), EVIDENCE_PHOTO_MAX_EDGE_PX, EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT)
  })

  it('keeps only the first page, with a warning, when iOS returns several', async () => {
    // VisionKit ignores maxNumDocuments, so the driver can scan more than the one sheet.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockScan.mockResolvedValue({ status: 'success', scannedImages: ['FIRST', 'SECOND'] })

    expect(await scanLinehaulSheet()).toBe('data:image/jpeg;base64,SMALL')
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('data:image/jpeg;base64,FIRST')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not warn for a single page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockScan.mockResolvedValue({ status: 'success', scannedImages: ['ONLY'] })

    await scanLinehaulSheet()

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns null when the driver cancels', async () => {
    mockScan.mockResolvedValue({ status: 'cancel' })

    expect(await scanLinehaulSheet()).toBeNull()
  })
})
