// Opens the phone's own document scanner (VisionKit on iOS, ML Kit on Android): it finds
// the page edges and flattens the perspective, which a plain camera photo cannot. Native
// only; the browser keeps the plain camera input (CameraCapture's file picker).
import { DocumentScanner, ResponseType, ScanDocumentResponseStatus } from '@capgo/capacitor-document-scanner'
import { fileToCompressedJpegDataUrl } from '@/lib/utils/image'
import { EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT, EVIDENCE_PHOTO_MAX_EDGE_PX } from '@/lib/constants/evidence-photo'

export async function scanLinehaulSheet(): Promise<string | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments: 1,
    responseType: ResponseType.Base64,
    letUserAdjustCrop: false,
    croppedImageQuality: EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
  })
  const pages = result.scannedImages ?? []
  const [page] = pages
  if (result.status === ScanDocumentResponseStatus.Cancel || page === undefined) return null
  if (pages.length > 1) {
    console.warn(`Linehaul scan returned ${pages.length} pages; keeping the first and dropping the rest.`)
  }
  const blob = await (await fetch(`data:image/jpeg;base64,${page}`)).blob()
  return fileToCompressedJpegDataUrl(
    new File([blob], 'linehaul-scan.jpg', { type: 'image/jpeg' }),
    EVIDENCE_PHOTO_MAX_EDGE_PX,
    EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
  )
}
