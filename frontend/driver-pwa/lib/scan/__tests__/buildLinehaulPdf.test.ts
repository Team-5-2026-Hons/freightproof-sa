// frontend/driver-pwa/lib/scan/__tests__/buildLinehaulPdf.test.ts
import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib'
import { A4_PT, buildLinehaulPdf } from '../buildLinehaulPdf'

// A real 4x6 grey JPEG, so pdf-lib's embedJpg parses an actual image.
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2CiiigD//2Q=='

async function decode(dataUrl: string): Promise<PDFDocument> {
  // load() stamps dates itself unless told not to, which would hide what the file holds.
  return PDFDocument.load(dataUrl.replace(/^data:application\/pdf;base64,/, ''), { updateMetadata: false })
}

describe('buildLinehaulPdf', () => {
  it('returns a PDF data URL', async () => {
    const pdf = await buildLinehaulPdf(TINY_JPEG)

    expect(pdf.startsWith('data:application/pdf;base64,')).toBe(true)
    expect(atob(pdf.split(',')[1] ?? '').startsWith('%PDF-')).toBe(true)
  })

  it('is one A4 page titled as the linehaul sheet, with no creation date', async () => {
    const doc = await decode(await buildLinehaulPdf(TINY_JPEG))

    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(A4_PT[0])
    expect(height).toBeCloseTo(A4_PT[1])
    expect(doc.getTitle()).toBe('Linehaul sheet')
    expect(doc.getCreationDate()).toBeUndefined()
  })

  it('embeds the scan as the page\'s one image', async () => {
    const doc = await decode(await buildLinehaulPdf(TINY_JPEG))

    const xObjects = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
    const entries = xObjects?.entries() ?? []
    expect(entries).toHaveLength(1)
    const stream = doc.context.lookup(entries[0]![1], PDFStream)
    expect(stream.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('Image'))
    // DCTDecode: the JPEG bytes are stored as-is, not re-encoded.
    expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'))
    expect(stream.dict.get(PDFName.of('Width'))?.toString()).toBe('4')
    expect(stream.dict.get(PDFName.of('Height'))?.toString()).toBe('6')
  })

  it('rejects input that is not a JPEG data URL', async () => {
    await expect(buildLinehaulPdf('data:image/png;base64,iVBORw0KGgo=')).rejects.toThrow()
  })
})
