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

// A fresh id per test: the component caches downloads by artifact id for the page session.
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
    // Arrange
    fetchArtifactBytes.mockResolvedValue(BYTES)

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    // Assert: no click needed.
    expect(await screen.findByText('Byte-identical to the file whose hash is anchored on Hedera.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify again' })).toBeEnabled()
  })

  it('flags bytes that do not match the recorded hash', async () => {
    // Arrange
    fetchArtifactBytes.mockResolvedValue(new TextEncoder().encode('swapped').buffer)

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    // Assert
    expect(await screen.findByText(/Does NOT match the recorded hash/)).toHaveClass('text-err')
  })

  it('re-checks when asked to verify again', async () => {
    // Arrange
    const user = userEvent.setup()
    fetchArtifactBytes.mockResolvedValue(BYTES)
    render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByText(/Byte-identical/)

    // Act
    await user.click(screen.getByRole('button', { name: 'Verify again' }))

    // Assert
    expect(await screen.findByText(/Byte-identical/)).toBeInTheDocument()
    expect(fetchArtifactBytes).toHaveBeenCalledTimes(1)
  })

  it('explains an unsupported browser rather than failing silently', async () => {
    // Arrange: bytes arrive, but this page cannot hash them.
    const file = await fileFor()
    vi.stubGlobal('crypto', {})
    fetchArtifactBytes.mockResolvedValue(BYTES)

    // Act
    render(<EvidencePhoto token="tok" file={file} />)

    // Assert
    expect(await screen.findByText('This browser cannot verify (needs a secure HTTPS page)')).toBeInTheDocument()
  })

  it('downloads a file once per page session, however often the photo remounts', async () => {
    // Arrange
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const file = await fileFor()
    const first = render(<EvidencePhoto token="tok" file={file} />)
    await screen.findByText(/Byte-identical/)
    first.unmount()

    // Act
    render(<EvidencePhoto token="tok" file={file} />)

    // Assert
    expect(await screen.findByText(/Byte-identical/)).toBeInTheDocument()
    expect(fetchArtifactBytes).toHaveBeenCalledTimes(1)
  })

  it('cancels its download when it unmounts', async () => {
    // Arrange
    let signal: AbortSignal | undefined
    fetchArtifactBytes.mockImplementation((_token: string, _id: string, passed?: AbortSignal) => {
      signal = passed
      return new Promise(() => undefined)
    })
    const { unmount } = render(<EvidencePhoto token="tok" file={await fileFor()} />)
    expect(signal?.aborted).toBe(false)

    // Act
    unmount()

    // Assert
    expect(signal?.aborted).toBe(true)
  })

  it('does not report the failure of a download it cancelled itself', async () => {
    // Arrange
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchArtifactBytes.mockImplementation((_token: string, _id: string, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const { unmount } = render(<EvidencePhoto token="tok" file={await fileFor()} />)

    // Act
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Assert
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
    // Arrange
    fetchArtifactBytes.mockRejectedValue(status === 0 ? new TypeError('network down') : new PackError(status, 'x'))

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    // Assert
    expect(await screen.findByText(text)).toHaveClass('text-warn')
    expect(screen.queryByRole('button', { name: 'Retry' }) !== null).toBe(retry)
  })

  it('fetches again when Retry is pressed, and shows the file if it now works', async () => {
    // Arrange
    const user = userEvent.setup()
    fetchArtifactBytes.mockRejectedValueOnce(new PackError(503, 'busy')).mockResolvedValueOnce(BYTES)
    render(<EvidencePhoto token="tok" file={await fileFor()} />)

    // Act
    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    // Assert
    expect(await screen.findByText(/Byte-identical/)).toBeInTheDocument()
    expect(screen.queryByText('Temporarily unavailable')).not.toBeInTheDocument()
    expect(fetchArtifactBytes).toHaveBeenCalledTimes(2)
  })

  it('logs why a file failed to load', async () => {
    // Arrange
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchArtifactBytes.mockRejectedValue(new PackError(503, 'busy'))

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByText('Temporarily unavailable')

    // Assert
    expect(warn).toHaveBeenCalled()
  })
})

describe('EvidencePhoto — what is shown', () => {
  it('lazy-loads an image and falls back to a message when the browser cannot display it', async () => {
    // Arrange
    fetchArtifactBytes.mockResolvedValue(BYTES)
    render(<EvidencePhoto token="tok" file={await fileFor()} label="Photo 1 of 2" />)
    const image = await screen.findByRole('img', { name: 'Photo 1 of 2 evidence' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')

    // Act
    fireEvent.error(image)

    // Assert
    expect(await screen.findByText('Could not display this image')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('gives a non-image file an "Open file" link that opens in a new tab without the opener', async () => {
    // Arrange
    fetchArtifactBytes.mockResolvedValue(BYTES)

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor({ mime_type: 'application/pdf' })} />)

    // Assert
    const link = await screen.findByRole('link', { name: 'Open file' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(link.getAttribute('href')).toMatch(/^blob:/)
    expect(screen.getByText('application/pdf document')).toBeInTheDocument()
  })

  it('never types a blob as something a browser would run as a page of this site', async () => {
    // Arrange: evidence claiming to be HTML must not become a same-origin HTML blob.
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor({ mime_type: 'text/html' })} />)
    await screen.findByRole('link', { name: 'Open file' })

    // Assert
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/octet-stream')
  })

  it('keeps the declared type for a type that is safe to open', async () => {
    // Arrange
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor({ mime_type: 'application/pdf' })} />)
    await screen.findByRole('link', { name: 'Open file' })

    // Assert
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/pdf')
  })

  it('revokes its object URL on unmount', async () => {
    // Arrange
    fetchArtifactBytes.mockResolvedValue(BYTES)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { unmount } = render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByRole('img')

    // Act
    unmount()

    // Assert
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('gives every button a 44 px tap target', async () => {
    // Arrange
    fetchArtifactBytes.mockRejectedValue(new PackError(429, 'slow down'))

    // Act
    render(<EvidencePhoto token="tok" file={await fileFor()} />)
    await screen.findByText('Too many requests — try again shortly')

    // Assert
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11')
  })
})
