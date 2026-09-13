// Regression fence for the QR overflowing the screen (FP-238).
//
// The bug: qrcode's toCanvas writes canvas.style.width and .height ITSELF, from the
// `width` option it is given — and that option is the retina backing-store size, twice
// the intended CSS size. Left alone the code rendered at 2x, spilling off both edges of a
// handset and giving the whole step a horizontal scroll. React's inline style could not
// prevent it, because the library writes the style attribute after the commit.
//
// The mock below reproduces exactly that behaviour, so this suite fails again if the
// reassertion is ever removed as redundant-looking.
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn(async (canvas: HTMLCanvasElement, _value: string, opts: { width: number }) => {
      // Precisely what the real library does to the element it is handed.
      canvas.width = opts.width
      canvas.height = opts.width
      canvas.style.width = `${opts.width}px`
      canvas.style.height = `${opts.width}px`
    }),
  },
}))

const { QrCode } = await import('@/components/ui/QrCode')
const QRCode = (await import('qrcode')).default

beforeEach(() => vi.clearAllMocks())

describe('QrCode', () => {
  it('does not leave the canvas at the library-written pixel size', async () => {
    const { container } = render(<QrCode value="https://r.test/h/aaa" maxSizePx={260} />)

    const canvas = container.querySelector('canvas')
    await waitFor(() => expect(canvas?.style.width).toBe('100%'))
    expect(canvas?.style.height).toBe('100%')
  })

  it('caps the box at the requested size rather than fixing it there', async () => {
    // A ceiling, not a fixed width: the square has to shrink on a narrow handset, or the
    // page scrolls sideways — which is the failure this whole file exists for.
    const { container } = render(<QrCode value="https://r.test/h/aaa" maxSizePx={260} />)

    const box = container.querySelector('canvas')?.parentElement
    expect(box).toHaveStyle({ maxWidth: '260px' })
    expect(box?.className).toContain('w-full')
    expect(box?.className).toContain('aspect-square')
  })

  it('still draws at twice the CSS size, so the modules stay crisp', async () => {
    render(<QrCode value="https://r.test/h/aaa" maxSizePx={260} />)

    await waitFor(() => expect(QRCode.toCanvas).toHaveBeenCalled())
    expect(vi.mocked(QRCode.toCanvas).mock.calls[0][2]).toMatchObject({ width: 520 })
  })

  it('renders a same-sized placeholder while there is no code, so nothing shifts', () => {
    const { container } = render(<QrCode value={null} maxSizePx={260} />)

    expect(container.querySelector('canvas')).toBeNull()
    const placeholder = screen.getByRole('status')
    expect(placeholder).toHaveStyle({ maxWidth: '260px' })
    expect(placeholder.className).toContain('aspect-square')
  })

  it('falls back to the placeholder when the code cannot be drawn', async () => {
    vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error('too much data'))

    render(<QrCode value="https://r.test/h/aaa" />)

    await waitFor(() => expect(screen.getByLabelText(/code unavailable/i)).toBeInTheDocument())
  })
})
