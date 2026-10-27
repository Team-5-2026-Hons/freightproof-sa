import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError } from '@/lib/api'
import type { EvidenceFile } from '@/lib/types'
import { sha256Hex } from '@/lib/verify'
import { EvidencePhoto } from './EvidencePhoto'

const fetchArtifactBytes = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchArtifactBytes: (token: string, artifactId: string, signal?: AbortSignal) => fetchArtifactBytes(token, artifactId, signal),
}))

const BYTES = new TextEncoder().encode('JPEG bytes').buffer as ArrayBuffer

async function fileFor(overrides: Partial<EvidenceFile> = {}): Promise<EvidenceFile> {
  return {
    artifact_id: crypto.randomUUID(), role: 'seal_photo', sha256: await sha256Hex(BYTES), mime_type: 'image/jpeg',
    captured_at: '2026-09-12T11:00:00Z', tier: 'anchored', ...overrides,
  }
}

beforeEach(() => {
  fetchArtifactBytes.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('EvidencePhoto — loading', () => {
  it('verifies the bytes by itself as soon as they arrive, and keeps a button to do it again', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)

    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    expect(await screen.findByText('Byte-identical to the file whose hash is anchored on Hedera.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify again' })).toBeEnabled()
  })

  it('flags bytes that do not match the recorded hash', async () => {
    fetchArtifactBytes.mockResolvedValue(new TextEncoder().encode('swapped').buffer)

    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    expect(await screen.findByText(/Does NOT match the recorded hash/)).toHaveClass('text-err')
  })

  it('re-checks when asked to verify again', async () => {
    const user = userEvent.setup()
    fetchArtifactBytes.mockResolvedValue(BYTES)
    render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByText(/Byte-identical/)

    await user.click(screen.getByRole('button', { name: 'Verify again' }))

    expect(await screen.findByText(/Byte-identical/)).toBeInTheDocument()
    expect(fetchArtifactBytes).toHaveBeenCalledTimes(1)
  })

  it('explains an unsupported browser rather than failing silently', async () => {
    const file = await fileFor()
    vi.stubGlobal('crypto', {})
    fetchArtifactBytes.mockResolvedValue(BYTES)

    render(<EvidencePhoto token="tok" file={file} />)

    expect(await screen.findByText('This browser cannot verify (needs a secure HTTPS page)')).toBeInTheDocument()
  })

  it('downloads a file once per page session, however often the photo remounts', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const file = await fileFor()
    const first = render(<EvidencePhoto token="tok" file={file} />)
    await screen.findByText(/Byte-identical/)
    first.unmount()

    render(<EvidencePhoto token="tok" file={file} />)

    expect(await screen.findByText(/Byte-identical/)).toBeInTheDocument()
    expect(fetchArtifactBytes).toHaveBeenCalledTimes(1)
  })

  it('cancels its download when it unmounts', async () => {
    let signal: AbortSignal | undefined
    fetchArtifactBytes.mockImplementation((_token: string, _id: string, passed?: AbortSignal) => {
      signal = passed
      return new Promise(() => undefined)
    })
    const { unmount } = render(<EvidencePhoto token="tok" file={await fileFor()} />)
    expect(signal?.aborted).toBe(false)

    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('does not report the failure of a download it cancelled itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchArtifactBytes.mockImplementation((_token: string, _id: string, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const { unmount } = render(<EvidencePhoto token="tok" file={await fileFor()} />)

    unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('EvidencePhoto — failures', () => {
  it.each([
    [401, 'Access expired — reload the page to enter a new code', false],
    [409, 'The stored file no longer matches the one sealed — contact the issuing operator', false],
    [410, 'This link has been closed', false],
    [429, 'Too many requests — try again shortly', true],
    [503, 'Temporarily unavailable', true],
    [404, 'File unavailable', false],
    [0, 'File unavailable', false],
  ])('says what happened for status %i, and offers Retry only where it can help', async (status, text, retry) => {
    fetchArtifactBytes.mockRejectedValue(status === 0 ? new TypeError('network down') : new PackError(status, 'x'))

    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    expect(await screen.findByText(text)).toHaveClass('text-warn')
    expect(screen.queryByRole('button', { name: 'Retry' }) !== null).toBe(retry)
  })

  it('fetches again when Retry is pressed, and shows the file if it now works', async () => {
    const user = userEvent.setup()
    fetchArtifactBytes.mockRejectedValueOnce(new PackError(503, 'busy')).mockResolvedValueOnce(BYTES)
    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(/Byte-identical/)).toBeInTheDocument()
    expect(screen.queryByText('Temporarily unavailable')).not.toBeInTheDocument()
    expect(fetchArtifactBytes).toHaveBeenCalledTimes(2)
  })

  it('logs why a file failed to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchArtifactBytes.mockRejectedValue(new PackError(503, 'busy'))

    render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByText('Temporarily unavailable')

    expect(warn).toHaveBeenCalled()
  })
})

describe('EvidencePhoto — what is shown', () => {
  it('lazy-loads an image and falls back to a message when the browser cannot display it', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)
    render(<EvidencePhoto token="tok" file={await fileFor()} label="Photo 1 of 2" />)
    const image = await screen.findByRole('img', { name: 'Photo 1 of 2 evidence' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')

    fireEvent.error(image)

    expect(await screen.findByText('Could not display this image')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('gives a non-image file an "Open file" link that opens in a new tab without the opener', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)

    render(<EvidencePhoto token="tok" file={await fileFor({ mime_type: 'application/pdf' })} />)

    const link = await screen.findByRole('link', { name: 'Open file' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(link.getAttribute('href')).toMatch(/^blob:/)
    expect(screen.getByText('application/pdf document')).toBeInTheDocument()
  })

  it('never types a blob as something a browser would run as a page of this site', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    render(<EvidencePhoto token="tok" file={await fileFor({ mime_type: 'text/html' })} />)
    await screen.findByRole('link', { name: 'Open file' })

    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/octet-stream')
  })

  it('keeps the declared type for a type that is safe to open', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    render(<EvidencePhoto token="tok" file={await fileFor({ mime_type: 'application/pdf' })} />)
    await screen.findByRole('link', { name: 'Open file' })

    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/pdf')
  })

  it('revokes its object URL on unmount', async () => {
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { unmount } = render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByRole('img')

    unmount()

    expect(revoke).toHaveBeenCalledOnce()
  })

  it('gives every button a 44 px tap target', async () => {
    fetchArtifactBytes.mockRejectedValue(new PackError(429, 'slow down'))

    render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByText('Too many requests — try again shortly')

    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11')
  })
})
