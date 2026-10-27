// Wraps the scanned linehaul sheet in a one-page A4 PDF, on the phone, so dispatchers and
// insurers get a document they can print and file. The image inside is the very scan
// stored as linehaul_photo; the PDF adds nothing but the page, which is why both hashes
// can be anchored side by side (loading payload v3).
import { PDFDocument } from 'pdf-lib'

export const A4_PT: readonly [number, number] = [595.28, 841.89]
const PAGE_MARGIN_PT = 34

const JPEG_DATA_URL = /^data:image\/jpe?g;base64,/

export async function buildLinehaulPdf(jpegDataUrl: string): Promise<string> {
  if (!JPEG_DATA_URL.test(jpegDataUrl)) {
    throw new Error('The linehaul scan must be a JPEG to build its PDF.')
  }
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle('Linehaul sheet')

  const image = await doc.embedJpg(jpegDataUrl.replace(JPEG_DATA_URL, ''))
  const page = doc.addPage([A4_PT[0], A4_PT[1]])
  const scale = Math.min(
    (A4_PT[0] - 2 * PAGE_MARGIN_PT) / image.width,
    (A4_PT[1] - 2 * PAGE_MARGIN_PT) / image.height,
  )
  const width = image.width * scale
  const height = image.height * scale
  page.drawImage(image, {
    x: (A4_PT[0] - width) / 2,
    y: (A4_PT[1] - height) / 2,
    width,
    height,
  })

  return doc.saveAsBase64({ dataUri: true })
}
