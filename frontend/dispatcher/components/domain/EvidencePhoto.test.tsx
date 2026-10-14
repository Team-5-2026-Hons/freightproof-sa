import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EvidencePhoto } from './EvidencePhoto'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

vi.mock('@/components/blockchain/ForensicOnly', () => ({ ForensicOnly: () => null }))
const artifact = { id: 'photo', signed_url: '/photo.jpg', captured_lat: null, captured_lng: null, file_hash: 'abc', captured_at: '2026-01-01T00:00:00Z' } as EvidenceArtifactWithUrl

describe('EvidencePhoto recovery', () => {
  it('distinguishes absent capture, lookup failure and loading', () => {
    const { rerender } = render(<EvidencePhoto label="Seal" artifact={undefined} />)
    expect(screen.getByText('Not captured')).toBeInTheDocument()
    rerender(<EvidencePhoto label="Seal" artifact={undefined} artifactId="photo" loading />)
    expect(screen.getByText('Loading evidence…')).toBeInTheDocument()
    rerender(<EvidencePhoto label="Seal" artifact={undefined} artifactId="photo" />)
    expect(screen.getByText('Recorded artifact unavailable')).toBeInTheDocument()
    rerender(<EvidencePhoto label="Seal" artifact={undefined} artifactId="photo" error="Unavailable" />)
    expect(screen.getByText('Evidence lookup failed')).toBeInTheDocument()
  })
  it('offers one explicit retry after an image error and recovers', () => {
    const retry = vi.fn()
    render(<EvidencePhoto label="Seal" artifact={artifact} onRetry={retry} />)
    fireEvent.error(screen.getByRole('img', { name: 'Seal' }))
    expect(screen.getByText('Image failed to load')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry Seal' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: 'Seal' })).toBeInTheDocument()
  })
})

describe('EvidencePhoto thumbnail size', () => {
  it('loads its thumbnail lazily', () => {
    render(<EvidencePhoto label="Seal" artifact={artifact} />)
    expect(screen.getByRole('img', { name: 'Seal' })).toHaveAttribute('loading', 'lazy')
  })
  it('keeps the 96 px thumbnail by default, so every existing caller is unchanged', () => {
    render(<EvidencePhoto label="Seal" artifact={artifact} />)

    expect(screen.getByRole('img', { name: 'Seal' })).toHaveClass('w-[96px]', 'h-[96px]')
  })

  it('draws a 44 px thumbnail for a Recorded row, and the same modal opens from it', () => {
    render(<EvidencePhoto label="Seal" artifact={artifact} size="compact" />)

    const thumbnail = screen.getByRole('img', { name: 'Seal' })
    expect(thumbnail).toHaveClass('w-11', 'h-11')
    expect(thumbnail).not.toHaveClass('w-[96px]')
    fireEvent.click(screen.getByRole('button', { name: 'Open Seal' }))
    expect(screen.getAllByRole('img', { name: 'Seal' })).toHaveLength(2)
  })
})
