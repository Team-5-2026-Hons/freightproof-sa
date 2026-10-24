// Opens the phone's own document scanner (VisionKit on iOS, ML Kit on Android): it finds
// the page edges and flattens the perspective, which a plain camera photo cannot. Native
// only; the browser keeps the plain camera input (CameraCapture's file picker).
import { DocumentScanner, ResponseType, ScanDocumentResponseStatus } from '@capgo/capacitor-document-scanner'
import { fileToCompressedJpegDataUrl } from '@/lib/utils/image'
// Same cap and quality as every evidence photo (CameraCapture), so a scan fits the
// localStorage draft and the 10 MB upload cap the same way a photo does.
import { EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT, EVIDENCE_PHOTO_MAX_EDGE_PX } from '@/lib/constants/evidence-photo'

// Resolves the scanned page as a JPEG data URL, or null when the driver backs out. Throws
// on a scanner failure so CameraCapture can fall back to its file picker.
export async function scanLinehaulSheet(): Promise<string | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments: 1,
    responseType: ResponseType.Base64,
    // In @capgo/capacitor-document-scanner 7.2.5 this Android-only flag selects ML Kit's
    // mode: true is SCANNER_MODE_FULL, whose ML cleaning erases stains and fingers (an
    // edit to the content of an evidence document); false is SCANNER_MODE_BASE, crop and
    // rotate only. The plugin has no separate scannerMode option, and iOS ignores this
    // flag, so VisionKit's own review screen still lets the driver retake.
    letUserAdjustCrop: false,
    // Android only (default 100): without it a full-quality page crosses the bridge as
    // base64 only to be recompressed to this quality below.
    croppedImageQuality: EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
  })
  const pages = result.scannedImages ?? []
  const [page] = pages
  if (result.status === ScanDocumentResponseStatus.Cancel || page === undefined) return null
  if (pages.length > 1) {
    // iOS ignores maxNumDocuments, so VisionKit lets the driver scan several pages. The
    // linehaul sheet is one page; keep the first rather than fail the capture.
    console.warn(`Linehaul scan returned ${pages.length} pages; keeping the first and dropping the rest.`)
  }
  const blob = await (await fetch(`data:image/jpeg;base64,${page}`)).blob()
  return fileToCompressedJpegDataUrl(
    new File([blob], 'linehaul-scan.jpg', { type: 'image/jpeg' }),
    EVIDENCE_PHOTO_MAX_EDGE_PX,
    EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT,
  )
}
