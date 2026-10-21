// The step registry imports every step component, so anything a step imports statically
// is parsed on every step route. The linehaul PDF builder (pdf-lib + pako) must stay out of
// that graph and load only when the Linehaul step builds a PDF.
import { describe, it, expect, vi } from 'vitest'

const { pdfModuleEvaluated } = vi.hoisted(() => ({ pdfModuleEvaluated: vi.fn() }))

vi.mock('@/lib/scan/buildLinehaulPdf', () => {
  pdfModuleEvaluated()
  return { buildLinehaulPdf: vi.fn() }
})

describe('step registry', () => {
  it('does not load the linehaul PDF builder', async () => {
    await import('../registry')

    expect(pdfModuleEvaluated).not.toHaveBeenCalled()
  })
})
